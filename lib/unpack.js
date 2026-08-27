'use strict'

const assert = require('assert')
const EE = require('events').EventEmitter
const Parser = require('./parse.js')
const fs = require('fs')
const fsm = require('fs-minipass')
const path = require('path')
const mkdir = require('./mkdir.js')
const mkdirSync = mkdir.sync
const wc = require('./winchars.js')
const normPath = require('./normalize-windows-path.js')

const ONENTRY = Symbol('onEntry')
const CHECKFS = Symbol('checkFs')
const PRUNECACHE = Symbol('pruneCache')
const ISREUSABLE = Symbol('isReusable')
const MAKEFS = Symbol('makeFs')
const FILE = Symbol('file')
const DIRECTORY = Symbol('directory')
const LINK = Symbol('link')
const SYMLINK = Symbol('symlink')
const HARDLINK = Symbol('hardlink')
const ENSURE_NO_SYMLINK = Symbol('ensureNoSymlink')
const UNSUPPORTED = Symbol('unsupported')
const UNKNOWN = Symbol('unknown')
const CHECKPATH = Symbol('checkPath')
const STRIPABSOLUTEPATH = Symbol('stripAbsolutePath')
const MKDIR = Symbol('mkdir')
const ONERROR = Symbol('onError')
const PENDING = Symbol('pending')
const PEND = Symbol('pend')
const UNPEND = Symbol('unpend')
const ENDED = Symbol('ended')
const MAYBECLOSE = Symbol('maybeClose')
const SKIP = Symbol('skip')
const DOCHOWN = Symbol('doChown')
const UID = Symbol('uid')
const GID = Symbol('gid')
const crypto = require('crypto')
const DEFAULT_MAX_DEPTH = 1024

// Unlinks on Windows are not atomic.
//
// This means that if you have a file entry, followed by another
// file entry with an identical name, and you cannot re-use the file
// (because it's a hardlink, or because unlink:true is set, or it's
// Windows, which does not have useful nlink values), then the unlink
// will be committed to the disk AFTER the new file has been written
// over the old one, deleting the new file.
//
// To work around this, on Windows systems, we rename the file and then
// delete the renamed file.  It's a sloppy kludge, but frankly, I do not
// know of a better way to do this, given windows' non-atomic unlink
// semantics.
//
// See: https://github.com/npm/node-tar/issues/183
/* istanbul ignore next */
const unlinkFile = (path, cb) => {
  if (process.platform !== 'win32')
    return fs.unlink(path, cb)

  const name = path + '.DELETE.' + crypto.randomBytes(16).toString('hex')
  fs.rename(path, name, er => {
    if (er)
      return cb(er)
    fs.unlink(name, cb)
  })
}

/* istanbul ignore next */
const unlinkFileSync = path => {
  if (process.platform !== 'win32')
    return fs.unlinkSync(path)

  const name = path + '.DELETE.' + crypto.randomBytes(16).toString('hex')
  fs.renameSync(path, name)
  fs.unlinkSync(name)
}

// this.gid, entry.gid, this.processUid
const uint32 = (a, b, c) =>
  a === a >>> 0 ? a
  : b === b >>> 0 ? b
  : c

// clear the cache if it's a case-insensitive unicode-squashing match.
// we can't know if the current file system is case-sensitive or supports
// unicode fully, so we check for similarity on the maximally compatible
// representation.  Err on the side of pruning, since all it's doing is
// preventing lstats, and it's not the end of the world if we get a false
// positive.
// Note that a trailing slash is not significant to the file system, so
// 'foo' and 'foo/' have to land on the same cache key as well.
const cacheKeyNormalize = path => normPath(path)
  .replace(/\/+$/, '')
  .normalize('NFKD')
  .toLowerCase()

const pruneCache = (cache, abs) => {
  abs = cacheKeyNormalize(abs)
  for (const path of cache.keys()) {
    const pnorm = cacheKeyNormalize(path)
    if (pnorm === abs || pnorm.indexOf(abs + '/') === 0)
      cache.delete(path)
  }
}

const dropCache = cache => {
  for (const key of cache.keys())
    cache.delete(key)
}

// returns [root, stripped]
// Note that windows will think that //x/y/z/a has a "root" of //x/y, and in
// those cases, we want to sanitize it to x/y/z/a, not z/a, so we strip /
// explicitly if it's the first character.
// drive-specific relative paths on windows get their root stripped off even
// though they are not absolute, so `c:../foo` becomes ['c:', '../foo'], and
// cannot be resolved against the cwd of another drive letter.
const stripAbsolutePath = p => {
  let r = ''
  let parsed = path.win32.parse(p)
  while (path.win32.isAbsolute(p) || parsed.root) {
    // windows will think that //x/y/z has a "root" of //x/y/
    // but strip the //?/C:/ off of //?/C:/path
    const root = p.charAt(0) === '/' && p.slice(0, 4) !== '//?/' ? '/'
      : parsed.root
    p = p.substr(root.length)
    r += root
    parsed = path.win32.parse(p)
  }
  return [r, p]
}

class Unpack extends Parser {
  constructor (opt) {
    if (!opt)
      opt = {}

    opt.ondone = _ => {
      this[ENDED] = true
      this[MAYBECLOSE]()
    }

    super(opt)

    this.transform = typeof opt.transform === 'function' ? opt.transform : null

    this.writable = true
    this.readable = false

    this[PENDING] = 0
    this[ENDED] = false

    this.dirCache = opt.dirCache || new Map()

    if (typeof opt.uid === 'number' || typeof opt.gid === 'number') {
      // need both or neither
      if (typeof opt.uid !== 'number' || typeof opt.gid !== 'number')
        throw new TypeError('cannot set owner without number uid and gid')
      if (opt.preserveOwner)
        throw new TypeError(
          'cannot preserve owner in archive and also set owner explicitly')
      this.uid = opt.uid
      this.gid = opt.gid
      this.setOwner = true
    } else {
      this.uid = null
      this.gid = null
      this.setOwner = false
    }

    // default true for root
    if (opt.preserveOwner === undefined && typeof opt.uid !== 'number')
      this.preserveOwner = process.getuid && process.getuid() === 0
    else
      this.preserveOwner = !!opt.preserveOwner

    this.processUid = (this.preserveOwner || this.setOwner) && process.getuid ?
      process.getuid() : null
    this.processGid = (this.preserveOwner || this.setOwner) && process.getgid ?
      process.getgid() : null

    // prevent excessively deep nesting of subfolders
    // set to `Infinity` to remove this restriction
    this.maxDepth = typeof opt.maxDepth === 'number'
      ? opt.maxDepth
      : DEFAULT_MAX_DEPTH

    // mostly just for testing, but useful in some cases.
    // Forcibly trigger a chown on every entry, no matter what
    this.forceChown = opt.forceChown === true

    // turn ><?| in filenames into 0xf000-higher encoded forms
    this.win32 = !!opt.win32 || process.platform === 'win32'

    // do not unpack over files that are newer than what's in the archive
    this.newer = !!opt.newer

    // do not unpack over ANY files
    this.keep = !!opt.keep

    // do not set mtime/atime of extracted entries
    this.noMtime = !!opt.noMtime

    // allow .., absolute path entries, and unpacking through symlinks
    // without this, warn and skip .., relativize absolutes, and error
    // on symlinks in extraction path
    this.preservePaths = !!opt.preservePaths

    // unlink files and links before writing. This breaks existing hard
    // links, and removes symlink directories rather than erroring
    this.unlink = !!opt.unlink

    this.cwd = normPath(path.resolve(opt.cwd || process.cwd()))
    this.strip = +opt.strip || 0
    this.processUmask = process.umask()
    this.umask = typeof opt.umask === 'number' ? opt.umask : this.processUmask
    // default mode for dirs created as parents
    this.dmode = opt.dmode || (0o0777 & (~this.umask))
    this.fmode = opt.fmode || (0o0666 & (~this.umask))
    this.on('entry', entry => this[ONENTRY](entry))
  }

  [MAYBECLOSE] () {
    if (this[ENDED] && this[PENDING] === 0) {
      this.emit('prefinish')
      this.emit('finish')
      this.emit('end')
      this.emit('close')
    }
  }

  // Sanitize a path-shaped field of the entry ('path' or 'linkpath') in
  // place.  Both of them end up on the file system: 'path' is where the
  // entry is written, and 'linkpath' is the target a hard link is resolved
  // against and the literal contents of a symbolic link.  An absolute
  // linkpath escapes the extraction target just as surely as an absolute
  // path does, so the root comes off both.  A '..' is refused for the entry
  // path and for a hard link's linkpath, but left alone for a symbolic
  // link's -- see below.
  // Returns false when the entry has to be skipped entirely.
  [STRIPABSOLUTEPATH] (entry, field) {
    if (!entry[field] || this.preservePaths)
      return true

    const p = normPath(entry[field])
    // absolutes on posix are also absolutes on win32, and drive-relative
    // paths like 'c:../foo' have a root without being absolute at all, so
    // take the root off first and then look for '..' in what's left.
    const rootAndPath = stripAbsolutePath(p)
    const root = rootAndPath[0]
    const stripped = rootAndPath[1]
    const strippedParts = stripped.split('/')

    if (strippedParts.indexOf('..') !== -1) {
      // A '..' in the entry path always walks out of the extraction target,
      // and a hard link's linkpath does too, because [HARDLINK] resolves it
      // with path.resolve(this.cwd, linkpath) -- against the cwd, not against
      // the directory the entry itself lands in.  A linkpath that looks like
      // it stays inside when read relative to a deep entry ('a/b/c/../../x')
      // is therefore made relative to the top of the extraction target when
      // the link is actually created, and every '..' in it escapes.
      // A symbolic link's linkpath is only the literal contents of the link,
      // never resolved here, and '../sibling/file' is an ordinary relative
      // symbolic link, so those are kept exactly as the archive spelled them.
      if (field === 'path' || entry.type === 'Link') {
        this.warn(field + ' contains \'..\'', p)
        return false
      }
    }

    if (root) {
      // A symbolic link's linkpath keeps its '..' (see above), because on its
      // own that is just an ordinary relative link.  But once a root has come
      // off the front of it, what is left is still resolved against the
      // directory the entry lands in, and 'c:../../../../foo/bar' walks out of
      // the extraction target from there just as surely as an absolute target
      // would have.  Resolve the remainder from the entry's own directory and
      // refuse it if it lands outside.
      if (field !== 'path' && entry.type !== 'Link' &&
          strippedParts.indexOf('..') !== -1) {
        const entryDir = path.posix.dirname(normPath(entry.path))
        const resolved =
          path.posix.normalize(path.posix.join(entryDir, stripped))
        if (resolved.indexOf('../') === 0 || resolved === '..') {
          this.warn(field + ' escapes extraction directory', p)
          return false
        }
      }
      this.warn('stripping ' + root + ' from absolute ' + field, p)
      entry[field] = stripped
    }

    return true
  }

  [CHECKPATH] (entry) {
    const p = normPath(entry.path)
    const parts = p.split('/')

    if (isFinite(this.maxDepth) && parts.length > this.maxDepth) {
      this.warn('excessively deep subfolder nesting', {
        entry: entry,
        path: p,
        depth: parts.length,
        maxDepth: this.maxDepth
      })
      return false
    }

    if (this.strip) {
      const parts = normPath(entry.path).split('/')
      if (parts.length < this.strip)
        return false
      entry.path = parts.slice(this.strip).join('/')

      if (entry.type === 'Link') {
        const linkparts = normPath(entry.linkpath).split('/')
        if (linkparts.length >= this.strip)
          entry.linkpath = linkparts.slice(this.strip).join('/')
      }
    }

    if (!this[STRIPABSOLUTEPATH](entry, 'path') ||
        !this[STRIPABSOLUTEPATH](entry, 'linkpath')) {
      return false
    }

    // only encode : chars that aren't drive letter indicators
    if (this.win32) {
      const parsed = path.win32.parse(entry.path)
      entry.path = parsed.root === '' ? wc.encode(entry.path)
        : parsed.root + wc.encode(entry.path.substr(parsed.root.length))
    }

    if (path.isAbsolute(entry.path))
      entry.absolute = normPath(entry.path)
    else
      entry.absolute = normPath(path.resolve(this.cwd, entry.path))

    // if we somehow ended up with a path that escapes the cwd, and we are
    // not in preservePaths mode, then something is fishy!  This should have
    // been prevented above, so ignore this for coverage.
    /* istanbul ignore if - defense in depth */
    if (!this.preservePaths &&
        entry.absolute.indexOf(this.cwd + '/') !== 0 &&
        entry.absolute !== this.cwd) {
      this.warn('path escaped extraction target', {
        entry: entry,
        path: normPath(entry.path),
        resolvedPath: entry.absolute,
        cwd: this.cwd
      })
      return false
    }

    return true
  }

  [ONENTRY] (entry) {
    if (!this[CHECKPATH](entry))
      return entry.resume()

    assert.equal(typeof entry.absolute, 'string')

    switch (entry.type) {
      case 'Directory':
      case 'GNUDumpDir':
        if (entry.mode)
          entry.mode = entry.mode | 0o700

      case 'File':
      case 'OldFile':
      case 'ContiguousFile':
      case 'Link':
      case 'SymbolicLink':
        return this[CHECKFS](entry)

      case 'CharacterDevice':
      case 'BlockDevice':
      case 'FIFO':
        return this[UNSUPPORTED](entry)
    }
  }

  [ONERROR] (er, entry) {
    // Cwd has to exist, or else nothing works. That's serious.
    // Other errors are warnings, which raise the error in strict
    // mode, but otherwise continue on.
    if (er.name === 'CwdError')
      this.emit('error', er)
    else {
      this.warn(er.message, er)
      this[UNPEND]()
      entry.resume()
    }
  }

  [MKDIR] (dir, mode, cb) {
    mkdir(normPath(dir), {
      uid: this.uid,
      gid: this.gid,
      processUid: this.processUid,
      processGid: this.processGid,
      umask: this.processUmask,
      preserve: this.preservePaths,
      unlink: this.unlink,
      cache: this.dirCache,
      cwd: this.cwd,
      mode: mode
    }, cb)
  }

  [DOCHOWN] (entry) {
    // in preserve owner mode, chown if the entry doesn't match process
    // in set owner mode, chown if setting doesn't match process
    return this.forceChown ||
      this.preserveOwner &&
      ( typeof entry.uid === 'number' && entry.uid !== this.processUid ||
        typeof entry.gid === 'number' && entry.gid !== this.processGid )
      ||
      ( typeof this.uid === 'number' && this.uid !== this.processUid ||
        typeof this.gid === 'number' && this.gid !== this.processGid )
  }

  [UID] (entry) {
    return uint32(this.uid, entry.uid, this.processUid)
  }

  [GID] (entry) {
    return uint32(this.gid, entry.gid, this.processGid)
  }

  [FILE] (entry) {
    const mode = entry.mode & 0o7777 || this.fmode
    const stream = new fsm.WriteStream(entry.absolute, {
      mode: mode,
      autoClose: false
    })
    stream.on('error', er => this[ONERROR](er, entry))

    let actions = 1
    const done = er => {
      if (er)
        return this[ONERROR](er, entry)

      if (--actions === 0)
        fs.close(stream.fd, _ => this[UNPEND]())
    }

    stream.on('finish', _ => {
      // if futimes fails, try utimes
      // if utimes fails, fail with the original error
      // same for fchown/chown
      const abs = entry.absolute
      const fd = stream.fd

      if (entry.mtime && !this.noMtime) {
        actions++
        const atime = entry.atime || new Date()
        const mtime = entry.mtime
        fs.futimes(fd, atime, mtime, er =>
          er ? fs.utimes(abs, atime, mtime, er2 => done(er2 && er))
          : done())
      }

      if (this[DOCHOWN](entry)) {
        actions++
        const uid = this[UID](entry)
        const gid = this[GID](entry)
        fs.fchown(fd, uid, gid, er =>
          er ? fs.chown(abs, uid, gid, er2 => done(er2 && er))
          : done())
      }

      done()
    })

    const tx = this.transform ? this.transform(entry) || entry : entry
    if (tx !== entry) {
      tx.on('error', er => this[ONERROR](er, entry))
      entry.pipe(tx)
    }
    tx.pipe(stream)
  }

  [DIRECTORY] (entry) {
    const mode = entry.mode & 0o7777 || this.dmode
    this[MKDIR](entry.absolute, mode, er => {
      if (er)
        return this[ONERROR](er, entry)

      let actions = 1
      const done = _ => {
        if (--actions === 0) {
          this[UNPEND]()
          entry.resume()
        }
      }

      if (entry.mtime && !this.noMtime) {
        actions++
        fs.utimes(entry.absolute, entry.atime || new Date(), entry.mtime, done)
      }

      if (this[DOCHOWN](entry)) {
        actions++
        fs.chown(entry.absolute, this[UID](entry), this[GID](entry), done)
      }

      done()
    })
  }

  [UNSUPPORTED] (entry) {
    this.warn('unsupported entry type: ' + entry.type, entry)
    entry.resume()
  }

  [SYMLINK] (entry) {
    // the contents of a symbolic link are resolved against the directory the
    // link itself lives in, so that is what the walk has to follow
    const parts = normPath(
      path.relative(this.cwd,
        path.resolve(path.dirname(entry.absolute), entry.linkpath))
    ).split('/')
    this[ENSURE_NO_SYMLINK](
      entry,
      this.cwd,
      parts,
      _ => this[LINK](entry, entry.linkpath, 'symlink'),
      er => this[ONERROR](er, entry)
    )
  }

  [HARDLINK] (entry) {
    const linkpath = normPath(path.resolve(this.cwd, entry.linkpath))
    const parts = normPath(entry.linkpath).split('/')
    this[ENSURE_NO_SYMLINK](
      entry,
      this.cwd,
      parts,
      _ => this[LINK](entry, linkpath, 'link'),
      er => this[ONERROR](er, entry)
    )
  }

  // Walk every component of a link target, and refuse the entry outright if
  // any of them is a symbolic link.  Otherwise fs.link() and fs.symlink()
  // happily resolve the target through a symlink planted by an earlier entry
  // (or already sitting on disk), and the link ends up pointing at a file
  // outside the extraction target even though the linkpath itself was clean.
  [ENSURE_NO_SYMLINK] (entry, cwd, parts, done, onError) {
    const p = parts.shift()
    if (this.preservePaths || p === undefined)
      return done()
    const t = path.resolve(cwd, p)
    fs.lstat(t, (er, st) => {
      // a component that isn't there can't be a symlink; let the link itself
      // fail with the real errno
      if (er)
        return done()
      if (st.isSymbolicLink()) {
        return onError(
          new Error('TAR_SYMLINK_ERROR: Cannot extract through symbolic link'))
      }
      this[ENSURE_NO_SYMLINK](entry, t, parts, done, onError)
    })
  }

  [PEND] () {
    this[PENDING]++
  }

  [UNPEND] () {
    this[PENDING]--
    this[MAYBECLOSE]()
  }

  [SKIP] (entry) {
    this[UNPEND]()
    entry.resume()
  }

  // Check if we can reuse an existing filesystem entry safely and
  // overwrite it, rather than unlinking and recreating
  // Windows doesn't report a useful nlink, so we just never reuse entries
  [ISREUSABLE] (entry, st) {
    return entry.type === 'File' &&
      !this.unlink &&
      st.isFile() &&
      st.nlink <= 1 &&
      process.platform !== 'win32'
  }

  [PRUNECACHE] (entry) {
    // if we are not creating a directory, and the path is in the dirCache,
    // then that means we are about to delete the directory we created
    // previously, and it is no longer going to be a directory, and neither
    // is any of its children.
    // If a symbolic link is encountered, all bets are off.  There is no
    // reasonable way to sanitize the cache in such a way we will be able to
    // avoid having filesystem collisions.  If this happens with a non-symlink
    // entry, it'll just fail to unpack, but a symlink to a directory, using an
    // 8.3 shortname or certain unicode attacks, can evade detection and lead
    // to arbitrary writes to anywhere on the system.
    if (entry.type === 'SymbolicLink')
      dropCache(this.dirCache)
    else if (entry.type !== 'Directory')
      pruneCache(this.dirCache, entry.absolute)
  }

  // check if a thing is there, and if so, try to clobber it
  [CHECKFS] (entry) {
    this[PEND]()
    this[PRUNECACHE](entry)

    this[MKDIR](path.dirname(entry.absolute), this.dmode, er => {
      if (er)
        return this[ONERROR](er, entry)
      fs.lstat(entry.absolute, (er, st) => {
        if (st && (this.keep || this.newer && st.mtime > entry.mtime))
          this[SKIP](entry)
        else if (er || this[ISREUSABLE](entry, st))
          this[MAKEFS](null, entry)
        else if (st.isDirectory()) {
          if (entry.type === 'Directory') {
            if (!entry.mode || (st.mode & 0o7777) === entry.mode)
              this[MAKEFS](null, entry)
            else
              fs.chmod(entry.absolute, entry.mode, er => this[MAKEFS](er, entry))
          } else
            fs.rmdir(entry.absolute, er => this[MAKEFS](er, entry))
        } else
          unlinkFile(entry.absolute, er => this[MAKEFS](er, entry))
      })
    })
  }

  [MAKEFS] (er, entry) {
    if (er)
      return this[ONERROR](er, entry)

    switch (entry.type) {
      case 'File':
      case 'OldFile':
      case 'ContiguousFile':
        return this[FILE](entry)

      case 'Link':
        return this[HARDLINK](entry)

      case 'SymbolicLink':
        return this[SYMLINK](entry)

      case 'Directory':
      case 'GNUDumpDir':
        return this[DIRECTORY](entry)
    }
  }

  [LINK] (entry, linkpath, link) {
    // XXX: get the type ('symlink' or 'junction') for windows
    fs[link](linkpath, entry.absolute, er => {
      if (er)
        return this[ONERROR](er, entry)
      this[UNPEND]()
      entry.resume()
    })
  }
}

class UnpackSync extends Unpack {
  constructor (opt) {
    super(opt)
  }

  [CHECKFS] (entry) {
    this[PRUNECACHE](entry)

    const er = this[MKDIR](path.dirname(entry.absolute), this.dmode)
    if (er)
      return this[ONERROR](er, entry)
    try {
      const st = fs.lstatSync(entry.absolute)
      if (this.keep || this.newer && st.mtime > entry.mtime)
        return this[SKIP](entry)
      else if (this[ISREUSABLE](entry, st))
        return this[MAKEFS](null, entry)
      else {
        try {
          if (st.isDirectory()) {
            if (entry.type === 'Directory') {
              if (entry.mode && (st.mode & 0o7777) !== entry.mode)
                fs.chmodSync(entry.absolute, entry.mode)
            } else
              fs.rmdirSync(entry.absolute)
          } else
            unlinkFileSync(entry.absolute)
          return this[MAKEFS](null, entry)
        } catch (er) {
          return this[ONERROR](er, entry)
        }
      }
    } catch (er) {
      return this[MAKEFS](null, entry)
    }
  }

  [FILE] (entry) {
    const mode = entry.mode & 0o7777 || this.fmode

    const oner = er => {
      try { fs.closeSync(fd) } catch (_) {}
      if (er)
        this[ONERROR](er, entry)
    }

    let stream
    let fd
    try {
      fd = fs.openSync(entry.absolute, 'w', mode)
    } catch (er) {
      return oner(er)
    }
    const tx = this.transform ? this.transform(entry) || entry : entry
    if (tx !== entry) {
      tx.on('error', er => this[ONERROR](er, entry))
      entry.pipe(tx)
    }

    tx.on('data', chunk => {
      try {
        fs.writeSync(fd, chunk, 0, chunk.length)
      } catch (er) {
        oner(er)
      }
    })

    tx.on('end', _ => {
      let er = null
      // try both, falling futimes back to utimes
      // if either fails, handle the first error
      if (entry.mtime && !this.noMtime) {
        const atime = entry.atime || new Date()
        const mtime = entry.mtime
        try {
          fs.futimesSync(fd, atime, mtime)
        } catch (futimeser) {
          try {
            fs.utimesSync(entry.absolute, atime, mtime)
          } catch (utimeser) {
            er = futimeser
          }
        }
      }

      if (this[DOCHOWN](entry)) {
        const uid = this[UID](entry)
        const gid = this[GID](entry)

        try {
          fs.fchownSync(fd, uid, gid)
        } catch (fchowner) {
          try {
            fs.chownSync(entry.absolute, uid, gid)
          } catch (chowner) {
            er = er || fchowner
          }
        }
      }

      oner(er)
    })
  }

  [DIRECTORY] (entry) {
    const mode = entry.mode & 0o7777 || this.dmode
    const er = this[MKDIR](entry.absolute, mode)
    if (er)
      return this[ONERROR](er, entry)
    if (entry.mtime && !this.noMtime) {
      try {
        fs.utimesSync(entry.absolute, entry.atime || new Date(), entry.mtime)
      } catch (er) {}
    }
    if (this[DOCHOWN](entry)) {
      try {
        fs.chownSync(entry.absolute, this[UID](entry), this[GID](entry))
      } catch (er) {}
    }
    entry.resume()
  }

  [MKDIR] (dir, mode) {
    try {
      return mkdir.sync(normPath(dir), {
        uid: this.uid,
        gid: this.gid,
        processUid: this.processUid,
        processGid: this.processGid,
        umask: this.processUmask,
        preserve: this.preservePaths,
        unlink: this.unlink,
        cache: this.dirCache,
        cwd: this.cwd,
        mode: mode
      })
    } catch (er) {
      return er
    }
  }

  [ENSURE_NO_SYMLINK] (_entry, cwd, parts, done, onError) {
    if (this.preservePaths || !parts.length)
      return done()
    let t = cwd
    for (const p of parts) {
      t = path.resolve(t, p)
      let st
      try {
        st = fs.lstatSync(t)
      } catch (er) {
        // a component that isn't there can't be a symlink; let the link
        // itself fail with the real errno
        return done()
      }
      if (st.isSymbolicLink()) {
        return onError(
          new Error('TAR_SYMLINK_ERROR: Cannot extract through symbolic link'))
      }
    }
    done()
  }

  [LINK] (entry, linkpath, link) {
    try {
      fs[link + 'Sync'](linkpath, entry.absolute)
      entry.resume()
    } catch (er) {
      return this[ONERROR](er, entry)
    }
  }
}

Unpack.Sync = UnpackSync
module.exports = Unpack
