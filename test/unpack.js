'use strict'

process.umask(0o022)

const Unpack = require('../lib/unpack.js')
const UnpackSync = Unpack.Sync
const t = require('tap')
const MiniPass = require('minipass')

const makeTar = require('./make-tar.js')
const Header = require('../lib/header.js')
const z = require('minizlib')
const fs = require('fs')
const path = require('path')
const fixtures = path.resolve(__dirname, 'fixtures')
const files = path.resolve(fixtures, 'files')
const tars = path.resolve(fixtures, 'tars')
const parses = path.resolve(fixtures, 'parse')
const unpackdir = path.resolve(fixtures, 'unpack')
const rimraf = require('rimraf')
const mkdirp = require('mkdirp')
const mutateFS = require('mutate-fs')
const eos = require('end-of-stream')
const ReadEntry = require('../lib/read-entry.js')

t.teardown(_ => rimraf.sync(unpackdir))

t.test('setup', t => {
  rimraf.sync(unpackdir)
  mkdirp.sync(unpackdir)
  t.end()
})

t.test('basic file unpack tests', t => {
  const basedir = path.resolve(unpackdir, 'basic')
  t.teardown(_ => rimraf.sync(basedir))

  const cases = {
    'emptypax.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'one-byte.txt': 'a'
    },
    'body-byte-counts.tar': {
      '1024-bytes.txt': new Array(1024).join('x') + '\n',
      '512-bytes.txt': new Array(512).join('x') + '\n',
      'one-byte.txt': 'a',
      'zero-byte.txt': ''
    },
    'utf8.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'Ω.txt': 'Ω',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': 'Ω'
    },
    'file.tar': {
      'one-byte.txt': 'a'
    },
    'global-header.tar': {
      'one-byte.txt': 'a'
    },
    'long-pax.tar': {
      '120-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    },
    'long-paths.tar': {
      '100-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '120-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      '170-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/a.txt': 'short\n',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': 'Ω'
    }
  }

  const tarfiles = Object.keys(cases)
  t.plan(tarfiles.length)
  t.jobs = tarfiles.length

  tarfiles.forEach(tarfile => {
    t.test(tarfile, t => {
      const tf = path.resolve(tars, tarfile)
      const dir = path.resolve(basedir, tarfile)
      t.beforeEach(cb => {
        rimraf.sync(dir)
        mkdirp.sync(dir)
        cb()
      })

      const check = t => {
        const expect = cases[tarfile]
        Object.keys(expect).forEach(file => {
          const f = path.resolve(dir, file)
          t.equal(fs.readFileSync(f, 'utf8'), expect[file], file)
        })
        t.end()
      }

      t.plan(2)

      t.test('async unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const unpack = new Unpack({ cwd: dir, strict: true })
          fs.createReadStream(tf).pipe(unpack)
          eos(unpack, _ => check(t))
        })
        t.test('loose', t => {
          const unpack = new Unpack({ cwd: dir })
          fs.createReadStream(tf).pipe(unpack)
          eos(unpack, _ => check(t))
        })
      })

      t.test('sync unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const unpack = new UnpackSync({ cwd: dir })
          unpack.end(fs.readFileSync(tf))
          check(t)
        })
        t.test('loose', t => {
          const unpack = new UnpackSync({ cwd: dir })
          unpack.end(fs.readFileSync(tf))
          check(t)
        })
      })
    })
  })
})

t.test('cwd default to process cwd', t => {
  const u = new Unpack()
  const us = new UnpackSync()
  const cwd = process.cwd()
  t.equal(u.cwd, cwd)
  t.equal(us.cwd, cwd)
  t.end()
})

t.test('links!', t => {
  const dir = path.resolve(unpackdir, 'links')
  const data = fs.readFileSync(tars + '/links.tar')
  const stripData = fs.readFileSync(tars + '/links-strip.tar')

  t.plan(6)
  t.beforeEach(cb => mkdirp(dir, cb))
  t.afterEach(cb => rimraf(dir, cb))

  const check = t => {
    const hl1 = fs.lstatSync(dir + '/hardlink-1')
    const hl2 = fs.lstatSync(dir + '/hardlink-2')
    t.equal(hl1.dev, hl2.dev)
    t.equal(hl1.ino, hl2.ino)
    t.equal(hl1.nlink, 2)
    t.equal(hl2.nlink, 2)
    const sym = fs.lstatSync(dir + '/symlink')
    t.ok(sym.isSymbolicLink())
    t.equal(fs.readlinkSync(dir + '/symlink'), 'hardlink-2')
    t.end()
  }
  const checkForStrip = t => {
    const hl1 = fs.lstatSync(dir + '/hardlink-1')
    const hl2 = fs.lstatSync(dir + '/hardlink-2')
    const hl3 = fs.lstatSync(dir + '/1/2/3/hardlink-3')
    t.equal(hl1.dev, hl2.dev)
    t.equal(hl1.ino, hl2.ino)
    t.equal(hl1.dev, hl3.dev)
    t.equal(hl1.ino, hl3.ino)
    t.equal(hl1.nlink, 3)
    t.equal(hl2.nlink, 3)
    const sym = fs.lstatSync(dir + '/symlink')
    t.ok(sym.isSymbolicLink())
    t.equal(fs.readlinkSync(dir + '/symlink'), 'hardlink-2')
    t.end()
  }
  const checkForStrip3 = t => {
    t.ok(fs.lstatSync(dir + '/3').isDirectory())
    let err = null
    try {
      fs.lstatSync(dir + '/3/hardlink-3')
    } catch(e) {
      err = e
    }
    // can't be extracted because we've passed it in the tar (specially crafted tar for this not to work)
    t.equal(err.code, 'ENOENT')
    t.end()
  }

  t.test('async', t => {
    const unpack = new Unpack({ cwd: dir })
    let finished = false
    unpack.on('finish', _ => finished = true)
    unpack.on('close', _ => t.ok(finished, 'emitted finish before close'))
    unpack.on('close', _ => check(t))
    unpack.end(data)
  })

  t.test('sync', t => {
    const unpack = new UnpackSync({ cwd: dir })
    unpack.end(data)
    check(t)
  })

  t.test('sync strip', t => {
    const unpack = new UnpackSync({ cwd: dir, strip: 1 })
    unpack.end(fs.readFileSync(tars + '/links-strip.tar'))
    checkForStrip(t)
  })

  t.test('async strip', t => {
    const unpack = new Unpack({ cwd: dir, strip: 1 })
    let finished = false
    unpack.on('finish', _ => finished = true)
    unpack.on('close', _ => t.ok(finished, 'emitted finish before close'))
    unpack.on('close', _ => checkForStrip(t))
    unpack.end(stripData)
  })

  t.test('sync strip 3', t => {
    const unpack = new UnpackSync({ cwd: dir, strip: 3 })
    unpack.end(fs.readFileSync(tars + '/links-strip.tar'))
    checkForStrip3(t)
  })

  t.test('async strip 3', t => {
    const unpack = new Unpack({ cwd: dir, strip: 3 })
    let finished = false
    unpack.on('finish', _ => finished = true)
    unpack.on('close', _ => t.ok(finished, 'emitted finish before close'))
    unpack.on('close', _ => checkForStrip3(t))
    unpack.end(stripData)
  })
})

t.test('links without cleanup (exercise clobbering code)', t => {
  const dir = path.resolve(unpackdir, 'links')
  const data = fs.readFileSync(tars + '/links.tar')

  t.plan(6)
  mkdirp.sync(dir)
  t.teardown(_ => rimraf.sync(dir))

  t.beforeEach(cb => {
    // clobber this junk
    try {
      mkdirp.sync(dir + '/hardlink-1')
      mkdirp.sync(dir + '/hardlink-2')
      fs.writeFileSync(dir + '/symlink', 'not a symlink')
    } catch (er) {}
    cb()
  })

  const check = t => {
    const hl1 = fs.lstatSync(dir + '/hardlink-1')
    const hl2 = fs.lstatSync(dir + '/hardlink-2')
    t.equal(hl1.dev, hl2.dev)
    t.equal(hl1.ino, hl2.ino)
    t.equal(hl1.nlink, 2)
    t.equal(hl2.nlink, 2)
    const sym = fs.lstatSync(dir + '/symlink')
    t.ok(sym.isSymbolicLink())
    t.equal(fs.readlinkSync(dir + '/symlink'), 'hardlink-2')
    t.end()
  }

  t.test('async', t => {
    const unpack = new Unpack({ cwd: dir })
    let prefinished = false
    unpack.on('prefinish', _ => prefinished = true)
    unpack.on('finish', _ =>
      t.ok(prefinished, 'emitted prefinish before finish'))
    unpack.on('close', _ => check(t))
    unpack.end(data)
  })

  t.test('sync', t => {
    const unpack = new UnpackSync({ cwd: dir })
    unpack.end(data)
    check(t)
  })

  t.test('async again', t => {
    const unpack = new Unpack({ cwd: dir })
    eos(unpack, _ => check(t))
    unpack.end(data)
  })

  t.test('sync again', t => {
    const unpack = new UnpackSync({ cwd: dir })
    unpack.end(data)
    check(t)
  })

  t.test('async unlink', t => {
    const unpack = new Unpack({ cwd: dir, unlink: true })
    unpack.on('close', _ => check(t))
    unpack.end(data)
  })

  t.test('sync unlink', t => {
    const unpack = new UnpackSync({ cwd: dir, unlink: true })
    unpack.end(data)
    check(t)
  })
})

t.test('nested dir dupe', t => {
  const dir = path.resolve(unpackdir, 'nested-dir')
  mkdirp.sync(dir + '/d/e/e/p')
  t.teardown(_ => rimraf.sync(dir))
  const expect = {
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/a.txt': 'short\n',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc': 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    'd/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': 'Ω'
  }

  const check = t => {
    const entries = fs.readdirSync(dir)
    t.equal(entries.length, 1)
    t.equal(entries[0], 'd')
    Object.keys(expect).forEach(f => {
      const file = dir + '/' + f
      t.equal(fs.readFileSync(file, 'utf8'), expect[f])
    })
    t.end()
  }

  const unpack = new Unpack({ cwd: dir, strip: 8 })
  const data = fs.readFileSync(tars + '/long-paths.tar')
  // while we're at it, why not use gzip too?
  const zip = new z.Gzip()
  zip.pipe(unpack)
  unpack.on('close', _ => check(t))
  zip.end(data)
})

t.test('symlink in dir path', t => {
  const dir = path.resolve(unpackdir, 'symlink-junk')

  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'd/i',
      type: 'Directory'
    },
    {
      path: 'd/i/r/dir',
      type: 'Directory',
      mode: 0o751,
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z')
    },
    'a',
    {
      path: 'd/i/r/link',
      type: 'Link',
      linkpath: 'd/i/r/file',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/symlink',
      type: 'SymbolicLink',
      linkpath: './dir',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/symlink/x',
      type: 'File',
      size: 0,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    '',
    ''
  ])

  t.test('no clobbering', t => {
    const warnings = []
    const u = new Unpack({ cwd: dir, onwarn: (w,d) => warnings.push([w,d]) })
    u.on('close', _ => {
      t.equal(fs.lstatSync(dir + '/d/i').mode & 0o7777, 0o755)
      t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
      t.throws(_ => fs.statSync(dir + '/d/i/r/symlink/x'))
      t.equal(warnings.length, 1)
      t.equal(warnings[0][0], 'Cannot extract through symbolic link')
      t.match(warnings[0][1], {
        name: 'SylinkError',
        path: dir + '/d/i/r/symlink/',
        symlink: dir + '/d/i/r/symlink'
      })
      t.end()
    })
    u.end(data)
  })

  t.test('no clobbering, sync', t => {
    const warnings = []
    const u = new UnpackSync({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d])
    })
    u.end(data)
    t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
    t.throws(_ => fs.statSync(dir + '/d/i/r/symlink/x'))
    t.equal(warnings.length, 1)
    t.equal(warnings[0][0], 'Cannot extract through symbolic link')
    t.match(warnings[0][1], {
      name: 'SylinkError',
      path: dir + '/d/i/r/symlink/',
      symlink: dir + '/d/i/r/symlink'
    })
    t.end()
  })

  t.test('extract through symlink', t => {
    const warnings = []
    const u = new Unpack({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      preservePaths: true
    })
    u.on('close', _ => {
      t.same(warnings, [])
      t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
      t.ok(fs.lstatSync(dir + '/d/i/r/dir/x').isFile(), 'x thru link')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink/x').isFile(), 'x thru link')
      t.end()
    })
    u.end(data)
  })

  t.test('extract through symlink sync', t => {
    const warnings = []
    const u = new UnpackSync({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      preservePaths: true
    })
    u.end(data)
    t.same(warnings, [])
    t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
    t.ok(fs.lstatSync(dir + '/d/i/r/dir/x').isFile(), 'x thru link')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink/x').isFile(), 'x thru link')
    t.end()
  })

  t.test('clobber through symlink', t => {
    const warnings = []
    const u = new Unpack({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      unlink: true
    })
    u.on('close', _ => {
      t.same(warnings, [])
      t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
      t.notok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'no link')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isDirectory(), 'sym is dir')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink/x').isFile(), 'x thru link')
      t.end()
    })
    u.end(data)
  })

  t.test('clobber through symlink with busted unlink', t => {
    const poop = new Error('poop')
    t.teardown(mutateFS.fail('unlink', poop))
    const warnings = []
    const u = new Unpack({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      unlink: true
    })
    u.on('close', _ => {
      t.same(warnings, [[ 'poop', poop ]])
      t.end()
    })
    u.end(data)
  })

  t.test('clobber through symlink sync', t => {
    const warnings = []
    const u = new UnpackSync({
      cwd: dir,
      onwarn: (w,d) => warnings.push([w,d]),
      unlink: true
    })
    u.end(data)
    t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
    t.notok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'no link')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isDirectory(), 'sym is dir')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink/x').isFile(), 'x thru link')
    t.end()
  })

  t.test('clobber dirs', t => {
    mkdirp.sync(dir + '/d/i/r/dir')
    mkdirp.sync(dir + '/d/i/r/file')
    mkdirp.sync(dir + '/d/i/r/link')
    mkdirp.sync(dir + '/d/i/r/symlink')
    const warnings = []
    const u = new Unpack({
      cwd: dir,
      onwarn: (w, d) => {
        warnings.push([w,d])
      }
    })
    u.on('close', _ => {
      t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
      t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
      t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
      t.throws(_ => fs.statSync(dir + '/d/i/r/symlink/x'))
      t.equal(warnings.length, 1)
      t.equal(warnings[0][0], 'Cannot extract through symbolic link')
      t.match(warnings[0][1], {
        name: 'SylinkError',
        path: dir + '/d/i/r/symlink/',
        symlink: dir + '/d/i/r/symlink'
      })
      t.end()
    })
    u.end(data)
  })

  t.test('clobber dirs sync', t => {
    mkdirp.sync(dir + '/d/i/r/dir')
    mkdirp.sync(dir + '/d/i/r/file')
    mkdirp.sync(dir + '/d/i/r/link')
    mkdirp.sync(dir + '/d/i/r/symlink')
    const warnings = []
    const u = new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => {
        warnings.push([w,d])
      }
    })
    u.end(data)
    t.equal(fs.lstatSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.ok(fs.lstatSync(dir + '/d/i/r/file').isFile(), 'got file')
    t.ok(fs.lstatSync(dir + '/d/i/r/symlink').isSymbolicLink(), 'got symlink')
    t.throws(_ => fs.statSync(dir + '/d/i/r/symlink/x'))
    t.equal(warnings.length, 1)
    t.equal(warnings[0][0], 'Cannot extract through symbolic link')
    t.match(warnings[0][1], {
      name: 'SylinkError',
      path: dir + '/d/i/r/symlink/',
      symlink: dir + '/d/i/r/symlink'
    })
    t.end()
  })

  t.end()
})

t.test('unsupported entries', t => {
  const dir = path.resolve(unpackdir, 'unsupported-entries')
  mkdirp.sync(dir)
  t.teardown(_ => rimraf.sync(dir))
  const unknown = new Header({ path: 'qux', type: 'File', size: 4 })
  unknown.type = 'Z'
  unknown.encode()
  const data = makeTar([
    {
      path: 'dev/random',
      type: 'CharacterDevice'
    },
    {
      path: 'dev/hd0',
      type: 'BlockDevice'
    },
    {
      path: 'dev/fifo0',
      type: 'FIFO'
    },
    unknown.block,
    'asdf',
    '',
    ''
  ])

  t.test('basic, warns', t => {
    const warnings = []
    const u = new Unpack({ cwd: dir, onwarn: (w,d) => warnings.push([w,d]) })
    const expect = [
      ['unsupported entry type: CharacterDevice', { path: 'dev/random' }],
      ['unsupported entry type: BlockDevice', { path: 'dev/hd0' }],
      ['unsupported entry type: FIFO', { path: 'dev/fifo0' }]
    ]
    u.on('close', _ => {
      t.equal(fs.readdirSync(dir).length, 0)
      t.match(warnings, expect)
      t.end()
    })
    u.end(data)
  })

  t.test('strict, throws', t => {
    const warnings = []
    const errors = []
    const u = new Unpack({
      cwd: dir,
      strict: true,
      onwarn: (w,d) => warnings.push([w,d])
    })
    u.on('error', e => errors.push(e))
    u.on('close', _ => {
      t.equal(fs.readdirSync(dir).length, 0)
      t.same(warnings, [])
      t.match(errors, [
        {
          message: 'unsupported entry type: CharacterDevice',
          data: { path: 'dev/random' }
        },
        {
          message: 'unsupported entry type: BlockDevice',
          data: { path: 'dev/hd0' }
        },
        {
          message: 'unsupported entry type: FIFO',
          data: { path: 'dev/fifo0' }
        }
      ])
      t.end()
    })
    u.end(data)
  })

  t.end()
})


t.test('file in dir path', t => {
  const dir = path.resolve(unpackdir, 'file-junk')

  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'a',
    {
      path: 'd/i/r/file/a/b/c',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'b',
    '',
    ''
  ])

  t.test('fail because of file', t => {
    const check = t => {
      t.equal(fs.readFileSync(dir + '/d/i/r/file', 'utf8'), 'a')
      t.throws(_ => fs.statSync(dir + '/d/i/r/file/a/b/c'))
      t.end()
    }

    t.plan(2)

    t.test('async', t => {
      new Unpack({ cwd: dir }).on('close', _ => check(t)).end(data)
    })

    t.test('sync', t => {
      new UnpackSync({ cwd: dir }).end(data)
      check(t)
    })
  })

  t.test('clobber on through', t => {
    const check = t => {
      t.ok(fs.statSync(dir + '/d/i/r/file').isDirectory())
      t.equal(fs.readFileSync(dir + '/d/i/r/file/a/b/c', 'utf8'), 'b')
      t.end()
    }

    t.plan(2)

    t.test('async', t => {
      new Unpack({ cwd: dir, unlink: true }).on('close', _ => check(t)).end(data)
    })

    t.test('sync', t => {
      new UnpackSync({ cwd: dir, unlink: true }).end(data)
      check(t)
    })
  })

  t.end()
})

t.test('set umask option', t => {
  const dir = path.resolve(unpackdir, 'umask')
  mkdirp.sync(dir)
  t.tearDown(_ => rimraf.sync(dir))

  const data = makeTar([
    {
      path: 'd/i/r/dir',
      type: 'Directory',
      mode: 0o751
    },
    '',
    ''
  ])

  new Unpack({
    umask: 0o027,
    cwd: dir
  }).on('close', _ => {
    t.equal(fs.statSync(dir + '/d/i/r').mode & 0o7777, 0o750)
    t.equal(fs.statSync(dir + '/d/i/r/dir').mode & 0o7777, 0o751)
    t.end()
  }).end(data)
})

t.test('absolute paths', t => {
  const dir = path.join(unpackdir, 'absolute-paths')
  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const absolute = path.resolve(dir, 'd/i/r/absolute')
  t.ok(path.isAbsolute(absolute))
  const parsed = path.parse(absolute)
  const relative = absolute.substr(parsed.root.length)
  t.notOk(path.isAbsolute(relative))

  const data = makeTar([
    {
      path: absolute,
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'a',
    '',
    ''
  ])

  t.test('warn and correct', t => {
    const check = t => {
      t.same(warnings, [[
        'stripping / from absolute path',
        absolute
      ]])
      t.ok(fs.lstatSync(path.resolve(dir, relative)).isFile(), 'is file')
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _=> check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.test('preserve absolute path', t => {
    const check = t => {
      t.same(warnings, [])
      t.ok(fs.lstatSync(absolute).isFile(), 'is file')
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        preservePaths: true,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _=> check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        preservePaths: true,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.end()
})

t.test('.. paths', t => {
  const dir = path.join(unpackdir, 'dotted-paths')
  t.teardown(_ => rimraf.sync(dir))
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const fmode = 0o755
  const dotted = 'a/b/c/../d'
  const resolved = path.resolve(dir, dotted)

  const data = makeTar([
    {
      path: dotted,
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'd',
    '',
    ''
  ])

  t.test('warn and skip', t => {
    const check = t => {
      t.same(warnings, [[
        'path contains \'..\'',
        dotted
      ]])
      t.throws(_=>fs.lstatSync(resolved))
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        fmode: fmode,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _=> check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        fmode: fmode,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.test('preserve dotted path', t => {
    const check = t => {
      t.same(warnings, [])
      t.ok(fs.lstatSync(resolved).isFile(), 'is file')
      t.equal(fs.lstatSync(resolved).mode & 0o777, fmode, 'mode is 0755')
      t.end()
    }

    const warnings = []

    t.test('async', t => {
      warnings.length = 0
      new Unpack({
        fmode: fmode,
        preservePaths: true,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _=> check(t)).end(data)
    })

    t.test('sync', t => {
      warnings.length = 0
      new UnpackSync({
        fmode: fmode,
        preservePaths: true,
        cwd: dir,
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t)
    })

    t.end()
  })

  t.end()
})

t.test('fail all stats', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  let unmutate
  const dir = path.join(unpackdir, 'stat-fail')

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    mkdirp.sync(dir)
    unmutate = mutateFS.statFail(poop)
    cb()
  })
  t.afterEach(cb => {
    unmutate()
    rimraf.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'd/i/r/file/',
      type: 'Directory',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'a',
    {
      path: 'd/i/r/link',
      type: 'Link',
      linkpath: 'd/i/r/file',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/symlink',
      type: 'SymbolicLink',
      linkpath: './dir',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    '',
    ''
  ])

  const check = (t, expect) => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    const expect = [
      ['poop', poop],
      ['poop', poop]
    ]
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t, expect)).end(data)
  })

  t.test('sync', t => {
    const expect = [
      [
        String,
        {
          code: 'EISDIR',
          path: path.resolve(dir, 'd/i/r/file'),
          syscall: 'open'
        }
      ],
      [
        String,
        {
          dest: path.resolve(dir, 'd/i/r/link'),
          path: path.resolve(dir, 'd/i/r/file'),
          syscall: 'link'
        }
      ]
    ]
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t, expect)
  })

  t.end()
})

t.test('fail symlink', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  const unmutate = mutateFS.fail('symlink', poop)
  const dir = path.join(unpackdir, 'symlink-fail')
  t.teardown(_ => (unmutate(), rimraf.sync(dir)))

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'd/i/r/dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/symlink',
      type: 'SymbolicLink',
      linkpath: './dir',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    '',
    ''
  ])

  const check = (t, expect) => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    const expect = [['poop', poop]]
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t, expect)).end(data)
  })

  t.test('sync', t => {
    const expect = [['poop', poop]]
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t, expect)
  })

  t.end()
})

t.test('fail chmod', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  const unmutate = mutateFS.fail('chmod', poop)
  const dir = path.join(unpackdir, 'chmod-fail')
  t.teardown(_ => (unmutate(), rimraf.sync(dir)))

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'd/i/r/dir/',
      type: 'Directory',
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    '',
    ''
  ])

  const check = (t, expect) => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    const expect = [['poop', poop]]
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t, expect)).end(data)
  })

  t.test('sync', t => {
    const expect = [['poop', poop]]
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t, expect)
  })

  t.end()
})

t.test('fail mkdir', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  let unmutate
  const dir = path.join(unpackdir, 'mkdir-fail')
  t.teardown(_ => rimraf.sync(dir))

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    rimraf.sync(dir)
    mkdirp.sync(dir)
    unmutate = mutateFS.fail('mkdir', poop)
    cb()
  })
  t.afterEach(cb => {
    unmutate()
    cb()
  })

  const data = makeTar([
    {
      path: 'dir/',
      type: 'Directory',
      mode: 0o751,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z'),
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    '',
    ''
  ])

  const expect = [ [
    'ENOENT: no such file or directory, lstat \'' +
    path.resolve(dir, 'dir') + '\'',
    {
      code: 'ENOENT',
      syscall: 'lstat',
      path: path.resolve(dir, 'dir')
    }
  ] ]

  const check = t => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t)).end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('fail write', t => {
  const poop = new Error('poop')
  poop.code = 'EPOOP'
  const unmutate = mutateFS.fail('write', poop)
  const dir = path.join(unpackdir, 'write-fail')
  t.teardown(_ => (unmutate(), rimraf.sync(dir)))

  const warnings = []
  t.beforeEach(cb => {
    warnings.length = 0
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const data = makeTar([
    {
      path: 'x',
      type: 'File',
      size: 1,
      mode: 0o751,
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'x',
    '',
    ''
  ])

  const expect = [ [ 'poop', poop ] ]

  const check = t => {
    t.match(warnings, expect)
    warnings.forEach(w => t.equal(w[0], w[1].message))
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).on('close', _ => check(t)).end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      onwarn: (w, d) => warnings.push([w, d])
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('skip existing', t => {
  const dir = path.join(unpackdir, 'skip-newer')
  t.teardown(_ => rimraf.sync(dir))

  const date = new Date('2011-03-27T22:16:31.000Z')
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    fs.writeFileSync(dir + '/x', 'y')
    fs.utimesSync(dir + '/x', date, date)
    cb()
  })

  const data = makeTar([
    {
      path: 'x',
      type: 'File',
      size: 1,
      mode: 0o751,
      mtime: new Date('2013-12-19T17:00:00.000Z')
    },
    'x',
    '',
    ''
  ])

  const check = t => {
    const st = fs.lstatSync(dir + '/x')
    t.equal(st.atime.toISOString(), date.toISOString())
    t.equal(st.mtime.toISOString(), date.toISOString())
    const data = fs.readFileSync(dir + '/x', 'utf8')
    t.equal(data, 'y')
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      keep: true
    }).on('close', _ => check(t)).end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      keep: true
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('skip newer', t => {
  const dir = path.join(unpackdir, 'skip-newer')
  t.teardown(_ => rimraf.sync(dir))

  const date = new Date('2013-12-19T17:00:00.000Z')
  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    fs.writeFileSync(dir + '/x', 'y')
    fs.utimesSync(dir + '/x', date, date)
    cb()
  })

  const data = makeTar([
    {
      path: 'x',
      type: 'File',
      size: 1,
      mode: 0o751,
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    'x',
    '',
    ''
  ])

  const check = t => {
    const st = fs.lstatSync(dir + '/x')
    t.equal(st.atime.toISOString(), date.toISOString())
    t.equal(st.mtime.toISOString(), date.toISOString())
    const data = fs.readFileSync(dir + '/x', 'utf8')
    t.equal(data, 'y')
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      newer: true
    }).on('close', _ => check(t)).end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      newer: true
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('no mtime', t => {
  const dir = path.join(unpackdir, 'skip-newer')
  t.teardown(_ => rimraf.sync(dir))

  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const date = new Date('2011-03-27T22:16:31.000Z')
  const data = makeTar([
    {
      path: 'x/',
      type: 'Directory',
      size: 0,
      atime: date,
      ctime: date,
      mtime: date
    },
    {
      path: 'x/y',
      type: 'File',
      size: 1,
      mode: 0o751,
      atime: date,
      ctime: date,
      mtime: date
    },
    'x',
    '',
    ''
  ])

  const check = t => {
    // this may fail if it's run on March 27, 2011
    const stx = fs.lstatSync(dir + '/x')
    t.notEqual(stx.atime.toISOString(), date.toISOString())
    t.notEqual(stx.mtime.toISOString(), date.toISOString())
    const sty = fs.lstatSync(dir + '/x/y')
    t.notEqual(sty.atime.toISOString(), date.toISOString())
    t.notEqual(sty.mtime.toISOString(), date.toISOString())
    const data = fs.readFileSync(dir + '/x/y', 'utf8')
    t.equal(data, 'x')
    t.end()
  }

  t.test('async', t => {
    new Unpack({
      cwd: dir,
      noMtime: true
    }).on('close', _ => check(t)).end(data)
  })

  t.test('sync', t => {
    new UnpackSync({
      cwd: dir,
      noMtime: true
    }).end(data)
    check(t)
  })

  t.end()
})

t.test('unpack big enough to pause/drain', t => {
  const dir = path.resolve(unpackdir, 'drain-clog')
  mkdirp.sync(dir)
  t.tearDown(_ => rimraf.sync(dir))
  const stream = fs.createReadStream(fixtures + '/parses.tar')
  const u = new Unpack({
    cwd: dir,
    strip: 3,
    strict: true
  })

  u.on('ignoredEntry', entry =>
    t.fail('should not get ignored entry: ' + entry.path))

  u.on('close', _ => {
    t.pass('extraction finished')
    const actual = fs.readdirSync(dir)
    const expected = fs.readdirSync(parses)
    t.same(actual, expected)
    t.end()
  })

  stream.pipe(u)
})

t.test('set owner', t => {
  // fake it on platforms that don't have getuid
  const myUid = 501
  const myGid = 1024
  const getuid = process.getuid
  const getgid = process.getgid
  process.getuid = _ => myUid
  process.getgid = _ => myGid
  t.teardown(_ => (process.getuid = getuid, process.getgid = getgid))

  // can't actually do this because it requires root, but we can
  // verify that chown gets called.
  t.test('as root, defaults to true', t => {
    const getuid = process.getuid
    process.getuid = _ => 0
    const u = new Unpack()
    t.equal(u.preserveOwner, true, 'preserveOwner enabled')
    process.getuid = getuid
    t.end()
  })

  t.test('as non-root, defaults to false', t => {
    const getuid = process.getuid
    process.getuid = _ => 501
    const u = new Unpack()
    t.equal(u.preserveOwner, false, 'preserveOwner disabled')
    process.getuid = getuid
    t.end()
  })

  const data = makeTar([
    {
      uid: 2456124561,
      gid: 813708013,
      path: 'foo/',
      type: 'Directory'
    },
    {
      uid: myUid,
      gid: 813708013,
      path: 'foo/my-uid-different-gid',
      type: 'File',
      size: 3
    },
    'qux',
    {
      uid: 2456124561,
      path: 'foo/different-uid-nogid',
      type: 'Directory'
    },
    {
      uid: 2456124561,
      path: 'foo/different-uid-nogid/bar',
      type: 'File',
      size: 3
    },
    'qux',
    {
      gid: 813708013,
      path: 'foo/different-gid-nouid/bar',
      type: 'File',
      size: 3
    },
    'qux',
    {
      uid: myUid,
      gid: myGid,
      path: 'foo-mine/',
      type: 'Directory'
    },
    {
      uid: myUid,
      gid: myGid,
      path: 'foo-mine/bar',
      type: 'File',
      size: 3
    },
    'qux',
    {
      uid: myUid,
      path: 'foo-mine/nogid',
      type: 'Directory'
    },
    {
      uid: myUid,
      path: 'foo-mine/nogid/bar',
      type: 'File',
      size: 3
    },
    'qux',
    '',
    ''
  ])

  t.test('chown failure results in unpack failure', t => {
    const dir = path.resolve(unpackdir, 'chown')
    const poop = new Error('expected chown failure')
    const un = mutateFS.fail('chown', poop)
    const unl = mutateFS.fail('lchown', poop)
    const unf = mutateFS.fail('fchown', poop)

    t.teardown(_ => (un(), unf(), unl()))

    t.test('sync', t => {
      mkdirp.sync(dir)
      t.teardown(_ => rimraf.sync(dir))
      let warned = false
      const u = new Unpack.Sync({
        cwd: dir,
        preserveOwner: true,
        onwarn: (m, er) => {
          if (!warned) {
            warned = true
            t.equal(er, poop)
            t.end()
          }
        }
      })
      u.end(data)
    })

    t.test('async', t => {
      mkdirp.sync(dir)
      t.teardown(_ => rimraf.sync(dir))
      let warned = false
      const u = new Unpack({
        cwd: dir,
        preserveOwner: true,
        onwarn: (m, er) => {
          if (!warned) {
            warned = true
            t.equal(er, poop)
            t.end()
          }
        }
      })
      u.end(data)
    })

    t.test('cleanup', t => {
      rimraf.sync(dir)
      t.end()
    })

    t.end()
  })

  t.test('chown when true', t => {
    const dir = path.resolve(unpackdir, 'chown')
    const chown = fs.chown
    const chownSync = fs.chownSync
    const fchownSync = fs.fchownSync
    let called = 0
    fs.fchown = fs.chown = (path, owner, group, cb) => {
      called ++
      cb()
    }
    fs.chownSync = fs.fchownSync = _ => called++

    t.teardown(_ => {
      fs.chown = chown
      fs.chownSync = chownSync
      fs.fchownSync = fchownSync
    })

    t.test('sync', t => {
      mkdirp.sync(dir)
      t.teardown(_ => rimraf.sync(dir))
      called = 0
      const u = new Unpack.Sync({ cwd: dir, preserveOwner: true })
      u.end(data)
      t.ok(called >= 5, 'called chowns')
      t.end()
    })

    t.test('async', t => {
      mkdirp.sync(dir)
      t.teardown(_ => rimraf.sync(dir))
      called = 0
      const u = new Unpack({ cwd: dir, preserveOwner: true })
      u.end(data)
      u.on('close', _ => {
        t.ok(called >= 5, 'called chowns')
        t.end()
      })
    })

    t.end()
  })

  t.test('no chown when false', t => {
    const dir = path.resolve(unpackdir, 'nochown')
    const poop = new Error('poop')
    const un = mutateFS.fail('chown', poop)
    const unf = mutateFS.fail('fchown', poop)
    const unl = mutateFS.fail('lchown', poop)
    t.teardown(_ => {
      rimraf.sync(dir)
      un()
      unf()
      unl()
    })

    t.beforeEach(cb => mkdirp(dir, cb))
    t.afterEach(cb => rimraf(dir, cb))

    const check = t => {
      const dirStat = fs.statSync(dir + '/foo')
      t.notEqual(dirStat.uid, 2456124561)
      t.notEqual(dirStat.gid, 813708013)
      const fileStat = fs.statSync(dir + '/foo/my-uid-different-gid')
      t.notEqual(fileStat.uid, 2456124561)
      t.notEqual(fileStat.gid, 813708013)
      const dirStat2 = fs.statSync(dir + '/foo/different-uid-nogid')
      t.notEqual(dirStat2.uid, 2456124561)
      const fileStat2 = fs.statSync(dir + '/foo/different-uid-nogid/bar')
      t.notEqual(fileStat2.uid, 2456124561)
      t.end()
    }

    t.test('sync', t => {
      const u = new Unpack.Sync({ cwd: dir, preserveOwner: false })
      u.end(data)
      check(t)
    })

    t.test('async', t => {
      const u = new Unpack({ cwd: dir, preserveOwner: false })
      u.end(data)
      u.on('close', _ => check(t))
    })

    t.end()
  })

  t.end()
})

t.test('unpack when dir is not writable', t => {
  const data = makeTar([
    {
      path: 'a/',
      type: 'Directory',
      mode: 0o444
    },
    {
      path: 'a/b',
      type: 'File',
      size: 1
    },
    'a',
    '',
    ''
  ])

  const dir = path.resolve(unpackdir, 'nowrite-dir')
  t.beforeEach(cb => mkdirp(dir, cb))
  t.afterEach(cb => rimraf(dir, cb))

  const check = t => {
    t.equal(fs.statSync(dir + '/a').mode & 0o7777, 0o744)
    t.equal(fs.readFileSync(dir + '/a/b', 'utf8'), 'a')
    t.end()
  }

  t.test('sync', t => {
    const u = new Unpack.Sync({ cwd: dir, strict: true })
    u.end(data)
    check(t)
  })

  t.test('async', t => {
    const u = new Unpack({ cwd: dir, strict: true })
    u.end(data)
    u.on('close', _ => check(t))
  })

  t.end()
})

t.test('transmute chars on windows', t => {
  const data = makeTar([
    {
      path: '<|>?:.txt',
      size: 5,
      type: 'File'
    },
    '<|>?:',
    '',
    ''
  ])

  const dir = path.resolve(unpackdir, 'winchars')
  t.beforeEach(cb => mkdirp(dir, cb))
  t.afterEach(cb => rimraf(dir, cb))

  const hex = 'ef80bcef81bcef80beef80bfef80ba2e747874'
  const uglyName = Buffer.from(hex, 'hex').toString()
  const ugly = path.resolve(dir, uglyName)

  const check = t => {
    t.same(fs.readdirSync(dir), [ uglyName ])
    t.equal(fs.readFileSync(ugly, 'utf8'), '<|>?:')
    t.end()
  }

  t.test('async', t => {
    const u = new Unpack({
      cwd: dir,
      win32: true
    })
    u.end(data)
    u.on('close', _ => check(t))
  })

  t.test('sync', t => {
    const u = new Unpack.Sync({
      cwd: dir,
      win32: true
    })
    u.end(data)
    check(t)
  })

  t.end()
})

t.test('safely transmute chars on windows with absolutes', t => {
  // don't actually make the directory
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('mkdir', poop))

  const data = makeTar([
    {
      path: 'c:/x/y/z/<|>?:.txt',
      size: 5,
      type: 'File'
    },
    '<|>?:',
    '',
    ''
  ])

  const hex = 'ef80bcef81bcef80beef80bfef80ba2e747874'
  const uglyName = Buffer.from(hex, 'hex').toString()
  const uglyPath = 'c:/x/y/z/' + uglyName

  const u = new Unpack({
    win32: true,
    preservePaths: true
  })
  u.on('entry', entry => {
    t.equal(entry.path, uglyPath)
    t.end()
  })

  u.end(data)
})

t.test('use explicit chmod when required by umask', t => {
  process.umask(0o022)

  const basedir = path.resolve(unpackdir, 'umask-chmod')

  const data = makeTar([
    {
      path: 'x/y/z',
      mode: 0o775,
      type: 'Directory'
    },
    '',
    ''
  ])

  const check = t => {
    const st = fs.statSync(basedir + '/x/y/z')
    t.equal(st.mode & 0o777, 0o775)
    rimraf.sync(basedir)
    t.end()
  }

  t.test('async', t => {
    mkdirp.sync(basedir)
    const unpack = new Unpack({ cwd: basedir })
    unpack.on('close', _ => check(t))
    unpack.end(data)
  })

  return t.test('sync', t => {
    mkdirp.sync(basedir)
    const unpack = new Unpack.Sync({ cwd: basedir })
    unpack.end(data)
    check(t)
  })
})

t.test('chown implicit dirs and also the entries', t => {
  const basedir = path.resolve(unpackdir, 'chownr')

  // club these so that the test can run as non-root
  const chown = fs.chown
  const chownSync = fs.chownSync
  const lchown = fs.lchown
  const lchownSync = fs.lchownSync
  const fchown = fs.fchown
  const fchownSync = fs.fchownSync

  const getuid = process.getuid
  const getgid = process.getgid
  t.teardown(_ => {
    fs.chown = chown
    fs.chownSync = chownSync
    fs.lchown = lchown
    fs.lchownSync = lchownSync
    fs.fchown = fchown
    fs.fchownSync = fchownSync
    process.getgid = getgid
  })

  let chowns = 0

  let currentTest = null
  fs.fchown = fs.chown = (path, uid, gid, cb) => {
    currentTest.equal(uid, 420, 'chown(' + path + ') uid')
    currentTest.equal(gid, 666, 'chown(' + path + ') gid')
    chowns ++
    cb()
  }
  if (fs.lchown)
    fs.lchown = fs.fchown

  fs.chownSync = fs.fchownSync = (path, uid, gid) => {
    currentTest.equal(uid, 420, 'chownSync(' + path + ') uid')
    currentTest.equal(gid, 666, 'chownSync(' + path + ') gid')
    chowns ++
  }
  if (fs.lchownSync)
    fs.lchownSync = fs.fchownSync

  const data = makeTar([
    {
      path: 'a/b/c',
      mode: 0o775,
      type: 'File',
      size: 1,
      uid: null,
      gid: null
    },
    '.',
    {
      path: 'x/y/z',
      mode: 0o775,
      uid: 12345,
      gid: 54321,
      type: 'File',
      size: 1
    },
    '.',
    '',
    ''
  ])

  const check = t => {
    currentTest = null
    t.equal(chowns, 8)
    chowns = 0
    rimraf.sync(basedir)
    t.end()
  }

  t.test('throws when setting uid/gid improperly', t => {
    t.throws(_ => new Unpack({ uid: 420 }),
      TypeError('cannot set owner without number uid and gid'))
    t.throws(_ => new Unpack({ gid: 666 }),
      TypeError('cannot set owner without number uid and gid'))
    t.throws(_ => new Unpack({ uid: 1, gid: 2, preserveOwner: true }),
      TypeError('cannot preserve owner in archive and also set owner explicitly'))
    t.end()
  })

  const tests = () =>
    t.test('async', t => {
      currentTest = t
      mkdirp.sync(basedir)
      const unpack = new Unpack({ cwd: basedir, uid: 420, gid: 666 })
      unpack.on('close', _ => check(t))
      unpack.end(data)
    }).then(t.test('sync', t => {
      currentTest = t
      mkdirp.sync(basedir)
      const unpack = new Unpack.Sync({ cwd: basedir, uid: 420, gid: 666 })
      unpack.end(data)
      check(t)
    }))

  tests()

  t.test('make it look like processUid is 420', t => {
    process.getuid = () => 420
    t.end()
  })

  tests()

  t.test('make it look like processGid is 666', t => {
    process.getuid = getuid
    process.getgid = () => 666
    t.end()
  })

  return tests()
})

t.test('bad cwd setting', t => {
  const basedir = path.resolve(unpackdir, 'bad-cwd')
  mkdirp.sync(basedir)
  t.teardown(_ => rimraf.sync(basedir))

  const cases = [
    // the cwd itself
    {
      path: './',
      type: 'Directory'
    },
    // a file directly in the cwd
    {
      path: 'a',
      type: 'File'
    },
    // a file nested within a subdir of the cwd
    {
      path: 'a/b/c',
      type: 'File'
    }
  ]

  fs.writeFileSync(basedir + '/file', 'xyz')

  cases.forEach(c => t.test(c.type + ' ' + c.path, t => {
    const data = makeTar([
      {
        path: c.path,
        mode: 0o775,
        type: c.type,
        size: 0,
        uid: null,
        gid: null
      },
      '',
      ''
    ])

    t.test('cwd is a file', t => {
      const cwd = basedir + '/file'
      const opt = { cwd: cwd }

      t.throws(_ => new Unpack.Sync(opt).end(data), {
        name: 'CwdError',
        message: 'ENOTDIR: Cannot cd into \'' + cwd + '\'',
        path: cwd,
        code: 'ENOTDIR'
      })

      new Unpack(opt).on('error', er => {
        t.match(er, {
          name: 'CwdError',
          message: 'ENOTDIR: Cannot cd into \'' + cwd + '\'',
          path: cwd,
          code: 'ENOTDIR'
        })
        t.end()
      }).end(data)
    })

    return t.test('cwd is missing', t => {
      const cwd = basedir + '/asdf/asdf/asdf'
      const opt = { cwd: cwd }

      t.throws(_ => new Unpack.Sync(opt).end(data), {
        name: 'CwdError',
        message: 'ENOENT: Cannot cd into \'' + cwd + '\'',
        path: cwd,
        code: 'ENOENT'
      })

      new Unpack(opt).on('error', er => {
        t.match(er, {
          name: 'CwdError',
          message: 'ENOENT: Cannot cd into \'' + cwd + '\'',
          path: cwd,
          code: 'ENOENT'
        })
        t.end()
      }).end(data)
    })
  }))

  t.end()
})

t.test('transform', t => {
  const basedir = path.resolve(unpackdir, 'transform')
  t.teardown(_ => rimraf.sync(basedir))

  const cases = {
    'emptypax.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'one-byte.txt': '[a]'
    },
    'body-byte-counts.tar': {
      '1024-bytes.txt': new Array(1024).join('[x]') + '[\n]',
      '512-bytes.txt': new Array(512).join('[x]') + '[\n]',
      'one-byte.txt': '[a]',
      'zero-byte.txt': ''
    },
    'utf8.tar': {
      '🌟.txt': '🌟✧✩⭐︎✪✫✬✭✮⚝✯✰✵✶✷✸✹❂⭑⭒★☆✡☪✴︎✦✡️🔯✴️🌠\n',
      'Ω.txt': '[Ω]',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt': '[Ω]'
    }
  }

  const txFn = entry => {
    switch (path.basename(entry.path)) {
      case 'zero-bytes.txt':
        return entry

      case 'one-byte.txt':
      case '1024-bytes.txt':
      case '512-bytes.txt':
      case 'Ω.txt':
        return new Bracer()
    }
  }

  class Bracer extends MiniPass {
    write (data) {
      const d = data.toString().split('').map(c => '[' + c + ']').join('')
      return super.write(d)
    }
  }

  const tarfiles = Object.keys(cases)
  t.plan(tarfiles.length)
  t.jobs = tarfiles.length

  tarfiles.forEach(tarfile => {
    t.test(tarfile, t => {
      const tf = path.resolve(tars, tarfile)
      const dir = path.resolve(basedir, tarfile)
      t.beforeEach(cb => {
        rimraf.sync(dir)
        mkdirp.sync(dir)
        cb()
      })

      const check = t => {
        const expect = cases[tarfile]
        Object.keys(expect).forEach(file => {
          const f = path.resolve(dir, file)
          t.equal(fs.readFileSync(f, 'utf8'), expect[file], file)
        })
        t.end()
      }

      t.plan(2)

      t.test('async unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const unpack = new Unpack({ cwd: dir, strict: true, transform: txFn })
          fs.createReadStream(tf).pipe(unpack)
          eos(unpack, _ => check(t))
        })
        t.test('loose', t => {
          const unpack = new Unpack({ cwd: dir, transform: txFn })
          fs.createReadStream(tf).pipe(unpack)
          eos(unpack, _ => check(t))
        })
      })

      t.test('sync unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          const unpack = new UnpackSync({ cwd: dir, strict: true, transform: txFn })
          unpack.end(fs.readFileSync(tf))
          check(t)
        })
        t.test('loose', t => {
          const unpack = new UnpackSync({ cwd: dir, transform: txFn })
          unpack.end(fs.readFileSync(tf))
          check(t)
        })
      })
    })
  })
})

t.test('transform error', t => {
  const dir = path.resolve(unpackdir, 'transform-error')
  mkdirp.sync(dir)
  t.teardown(_ => rimraf.sync(dir))

  const tarfile = path.resolve(tars, 'body-byte-counts.tar')
  const tardata = fs.readFileSync(tarfile)
  const poop = new Error('poop')

  const txFn = () => {
    const tx = new MiniPass()
    tx.write = () => tx.emit('error', poop)
    tx.resume()
    return tx
  }

  t.test('sync unpack', t => {
    t.test('strict', t => {
      const unpack = new UnpackSync({ cwd: dir, strict: true, transform: txFn })
      const expect = 3
      let actual = 0
      unpack.on('error', er => {
        t.equal(er, poop)
        actual ++
      })
      unpack.end(tardata)
      t.equal(actual, expect, 'error count')
      t.end()
    })
    t.test('loose', t => {
      const unpack = new UnpackSync({ cwd: dir, transform: txFn })
      const expect = 3
      let actual = 0
      unpack.on('warn', (msg, er) => {
        t.equal(er, poop)
        actual ++
      })
      unpack.end(tardata)
      t.equal(actual, expect, 'error count')
      t.end()
    })
    t.end()
  })
  t.test('async unpack', t => {
    // the last error is about the folder being deleted, just ignore that one
    t.test('strict', t => {
      const unpack = new Unpack({ cwd: dir, strict: true, transform: txFn })
      t.plan(3)
      t.teardown(() => {
        unpack.removeAllListeners('error')
        unpack.on('error', () => {})
      })
      unpack.on('error', er => t.equal(er, poop))
      unpack.end(tardata)
    })
    t.test('loose', t => {
      const unpack = new Unpack({ cwd: dir, transform: txFn })
      t.plan(3)
      t.teardown(() => unpack.removeAllListeners('warn'))
      unpack.on('warn', (msg, er) => t.equal(er, poop))
      unpack.end(tardata)
    })
    t.end()
  })

  t.end()
})

t.test('futimes/fchown failures', t => {
  const archive = path.resolve(tars, 'utf8.tar')
  const dir = path.resolve(unpackdir, 'futimes-fchown-fails')
  const tardata = fs.readFileSync(archive)

  const poop = new Error('poop')
  const second = new Error('second error')

  const reset = cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
  }

  reset()
  t.teardown(() => rimraf.sync(dir))

  const methods = ['utimes', 'chown']
  methods.forEach(method => {
    const fc = method === 'chown'
    t.test(method +' fallback', t => {
      t.teardown(mutateFS.fail('f' + method, poop))
      // forceChown will fail on systems where the user is not root
      // and/or the uid/gid in the archive aren't valid. We're just
      // verifying coverage here, so make the method auto-pass.
      t.teardown(mutateFS.pass(method))
      t.plan(2)
      t.test('async unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          reset()
          const unpack = new Unpack({ cwd: dir, strict: true, forceChown: fc })
          unpack.on('finish', t.end)
          unpack.end(tardata)
        })
        t.test('loose', t => {
          reset()
          const unpack = new Unpack({ cwd: dir, forceChown: fc })
          unpack.on('finish', t.end)
          unpack.on('warn', t.fail)
          unpack.end(tardata)
        })
      })
      t.test('sync unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          reset()
          const unpack = new Unpack.Sync({ cwd: dir, strict: true, forceChown: fc })
          unpack.end(tardata)
          t.end()
        })
        t.test('loose', t => {
          reset()
          const unpack = new Unpack.Sync({ cwd: dir, forceChown: fc })
          unpack.on('warn', t.fail)
          unpack.end(tardata)
          t.end()
        })
      })
    })

    t.test('also fail ' + method, t => {
      const unmutate = mutateFS.fail('f' + method, poop)
      const unmutate2 = mutateFS.fail(method, second)
      t.teardown(() => {
        unmutate()
        unmutate2()
      })
      t.plan(2)
      t.test('async unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          reset()
          const unpack = new Unpack({ cwd: dir, strict: true, forceChown: fc })
          t.plan(3)
          unpack.on('error', er => t.equal(er, poop))
          unpack.end(tardata)
        })
        t.test('loose', t => {
          reset()
          const unpack = new Unpack({ cwd: dir, forceChown: fc })
          t.plan(3)
          unpack.on('warn', (m, er) => t.equal(er, poop))
          unpack.end(tardata)
        })
      })
      t.test('sync unpack', t => {
        t.plan(2)
        t.test('strict', t => {
          reset()
          const unpack = new Unpack.Sync({ cwd: dir, strict: true, forceChown: fc })
          t.plan(3)
          unpack.on('error', er => t.equal(er, poop))
          unpack.end(tardata)
        })
        t.test('loose', t => {
          reset()
          const unpack = new Unpack.Sync({ cwd: dir, forceChown: fc })
          t.plan(3)
          unpack.on('warn', (m, er) => t.equal(er, poop))
          unpack.end(tardata)
        })
      })
    })
  })

  t.end()
})

t.test('onentry option is preserved', t => {
  const basedir = path.resolve(unpackdir, 'onentry-method')
  mkdirp.sync(basedir)
  t.teardown(() => rimraf.sync(basedir))

  let oecalls = 0
  const onentry = entry => oecalls++
  const data = makeTar([
    {
      path: 'd/i',
      type: 'Directory'
    },
    {
      path: 'd/i/r/dir',
      type: 'Directory',
      mode: 0o751,
      mtime: new Date('2011-03-27T22:16:31.000Z')
    },
    {
      path: 'd/i/r/file',
      type: 'File',
      size: 1,
      atime: new Date('1979-07-01T19:10:00.000Z'),
      ctime: new Date('2011-03-27T22:16:31.000Z')
    },
    'a',
    '',
    ''
  ])

  const check = t => {
    t.equal(oecalls, 3)
    oecalls = 0
    t.end()
  }

  t.test('sync', t => {
    const dir = path.join(basedir, 'sync')
    mkdirp.sync(dir)
    const unpack = new UnpackSync({ cwd: dir, onentry })
    unpack.end(data)
    check(t)
  })

  t.test('async', t => {
    const dir = path.join(basedir, 'async')
    mkdirp.sync(dir)
    const unpack = new Unpack({ cwd: dir, onentry })
    unpack.on('finish', () => check(t))
    unpack.end(data)
  })

  t.end()
})

t.test('do not reuse hardlinks, only nlink=1 files', t => {
  const basedir = path.resolve(unpackdir, 'hardlink-reuse')
  mkdirp.sync(basedir)
  t.teardown(() => rimraf.sync(basedir))

  const now = new Date('2018-04-30T18:30:39.025Z')

  const data = makeTar([
    {
      path: 'overwriteme',
      type: 'File',
      size: 4,
      mode: 0o644,
      mtime: now
    },
    'foo\n',
    {
      path: 'link',
      linkpath: 'overwriteme',
      type: 'Link',
      mode: 0o644,
      mtime: now
    },
    {
      path: 'link',
      type: 'File',
      size: 4,
      mode: 0o644,
      mtime: now
    },
    'bar\n',
    '',
    ''
  ])

  const checks = {
    'link': 'bar\n',
    'overwriteme': 'foo\n'
  }

  const check = t => {
    for (let f in checks) {
      t.equal(fs.readFileSync(basedir + '/' + f, 'utf8'), checks[f], f)
      t.equal(fs.statSync(basedir + '/' + f).nlink, 1, f)
    }
    t.end()
  }

  t.test('async', t => {
    const u = new Unpack({ cwd: basedir })
    u.on('close', () => check(t))
    u.end(data)
  })

  t.test('sync', t => {
    const u = new UnpackSync({ cwd: basedir })
    u.end(data)
    check(t)
  })

  t.end()
})

t.test('drop entry from dirCache if no longer a directory', t => {
  const dir = path.resolve(unpackdir, 'dir-cache-error')
  mkdirp.sync(dir + '/sync/y')
  mkdirp.sync(dir + '/async/y')
  const data = makeTar([
    {
      path: 'x',
      type: 'Directory',
    },
    {
      path: 'x',
      type: 'SymbolicLink',
      linkpath: './y',
    },
    {
      path: 'x/ginkoid',
      type: 'File',
      size: 'ginkoid'.length,
    },
    'ginkoid',
    '',
    '',
  ])
  t.plan(2)
  const WARNINGS = {}
  const check = (t, path) => {
    t.equal(fs.statSync(path + '/x').isDirectory(), true)
    t.equal(fs.lstatSync(path + '/x').isSymbolicLink(), true)
    t.equal(fs.statSync(path + '/y').isDirectory(), true)
    t.strictSame(fs.readdirSync(path + '/y'), [])
    t.throws(() => fs.readFileSync(path + '/x/ginkoid'), { code: 'ENOENT' })
    t.strictSame(WARNINGS[path], [
      'Cannot extract through symbolic link',
    ])
    t.end()
  }
  t.test('async', t => {
    const path = dir + '/async'
    new Unpack({ cwd: path })
      .on('warn', (msg) => WARNINGS[path] = [msg])
      .on('end', () => check(t, path))
      .end(data)
  })
  t.test('sync', t => {
    const path = dir + '/sync'
    new UnpackSync({ cwd: path })
      .on('warn', (msg) => WARNINGS[path] = [msg])
      .end(data)
    check(t, path)
  })
})

const isWindows = process.platform === 'win32'

// CVE-2021-37701: the dirCache was keyed by the raw entry path, so an entry
// name containing a \ separator could seed cache entries that the pruning
// loop then failed to recognize as belonging to the symlink that replaced
// them.  Without normalizing separators, mkdir() split 'x\y' into two path
// segments while the dirCache, the symlink and the file all used the literal
// one-segment name -- so the file was written straight through the symlink.
// The link target is kept inside cwd so that this exercises the dirCache and
// nothing else.
t.test('dirCache poisoned by \\ in entry names', {
  skip: isWindows && 'symlinks not fully supported'
}, t => {
  const dir = path.resolve(unpackdir, 'dircache-backslash')
  t.teardown(_ => rimraf.sync(dir))

  const data = makeTar([
    {
      path: 'x\\y',
      type: 'Directory',
      mode: 0o755
    },
    {
      path: 'x\\y',
      type: 'SymbolicLink',
      linkpath: './elsewhere'
    },
    {
      path: 'x\\y/z',
      type: 'File',
      size: 5,
      mode: 0o644
    },
    'pwned',
    '',
    ''
  ])

  const setup = leg => {
    const legdir = path.resolve(dir, leg)
    rimraf.sync(legdir)
    mkdirp.sync(path.resolve(legdir, 'cwd'))
    mkdirp.sync(path.resolve(legdir, 'cwd', 'elsewhere'))
    return legdir
  }

  const check = (t, legdir, warnings) => {
    const cwd = path.resolve(legdir, 'cwd')
    const elsewhere = path.resolve(cwd, 'elsewhere')
    t.same(warnings, ['Cannot extract through symbolic link'],
      'refused to extract through the symlink')
    t.ok(fs.lstatSync(cwd + '/x\\y').isSymbolicLink(), 'entry is a symlink')
    t.throws(_ => fs.statSync(elsewhere + '/z'),
      'nothing written through the symbolic link')
    t.strictSame(fs.readdirSync(elsewhere), [], 'link target dir untouched')
    t.strictSame(fs.readdirSync(cwd).sort(), ['elsewhere', 'x\\y'],
      'the \\ name is one directory entry, not a x/y tree')
    t.throws(_ => fs.readFileSync(cwd + '/x\\y/z'), 'no file through the link')
    t.end()
  }

  t.test('async', t => {
    const legdir = setup('async')
    const warnings = []
    new Unpack({ cwd: path.resolve(legdir, 'cwd') })
      .on('warn', msg => warnings.push(msg))
      .on('close', _ => check(t, legdir, warnings))
      .end(data)
  })

  t.test('sync', t => {
    const legdir = setup('sync')
    const warnings = []
    new UnpackSync({ cwd: path.resolve(legdir, 'cwd') })
      .on('warn', msg => warnings.push(msg))
      .end(data)
    check(t, legdir, warnings)
  })

  t.end()
})

// CVE-2021-37701: the dirCache pruning was case-sensitive, so on a
// case-insensitive filesystem a 'FOO' symlink replacing the 'foo' directory
// left '<cwd>/foo' and '<cwd>/foo/bar' behind in the cache.  A later
// 'foo/bar/...' entry then hit the cache and skipped the symlink check
// entirely, writing through the link.  The escape itself is not reachable on
// a case-sensitive filesystem, so the stale-key invariant is the assertion.
t.test('prune dirCache on case-insensitive match', {
  skip: isWindows && 'symlinks not fully supported'
}, t => {
  const dir = path.resolve(unpackdir, 'dircache-case')
  t.teardown(_ => rimraf.sync(dir))

  const data = makeTar([
    {
      path: 'foo/bar',
      type: 'Directory',
      mode: 0o755
    },
    {
      path: 'FOO',
      type: 'SymbolicLink',
      linkpath: './elsewhere'
    },
    '',
    ''
  ])

  const setup = leg => {
    const cwd = path.resolve(dir, leg)
    rimraf.sync(cwd)
    mkdirp.sync(cwd)
    return cwd
  }

  const check = (t, cwd, dirCache) => {
    t.ok(fs.lstatSync(cwd + '/FOO').isSymbolicLink(), 'FOO is a symlink')
    t.notOk(dirCache.has(cwd + '/foo'), 'stale foo dirCache entry pruned')
    t.notOk(dirCache.has(cwd + '/foo/bar'), 'stale foo/bar dirCache entry pruned')
    t.strictSame(Array.from(dirCache.keys()), [cwd],
      'only the cwd is left in the dirCache')
    t.end()
  }

  t.test('async', t => {
    const cwd = setup('async')
    const dirCache = new Map()
    new Unpack({ cwd: cwd, dirCache: dirCache })
      .on('close', _ => check(t, cwd, dirCache))
      .end(data)
  })

  t.test('sync', t => {
    const cwd = setup('sync')
    const dirCache = new Map()
    new UnpackSync({ cwd: cwd, dirCache: dirCache }).end(data)
    check(t, cwd, dirCache)
  })

  t.end()
})

// CVE-2021-37701: on windows both \ and / are directory separators, so every
// path tar handles has to be normalized to / before it is compared against,
// or stored in, the dirCache.  Fake the platform to exercise that arm.
t.test('normalize \\ to / on windows', {
  skip: isWindows && 'fake platform test, run on posix'
}, t => {
  const dir = path.resolve(unpackdir, 'win32-normalize')

  // built with the real (posix) Header, before the platform is faked
  const data = makeTar([
    {
      path: 'a\\b/c',
      type: 'File',
      size: 1,
      mode: 0o644
    },
    'x',
    '',
    ''
  ])

  // tap 12 has no t.mock(), so swap the faked platform in and re-require the
  // library with a cleared cache, since normalize-windows-path.js reads the
  // platform once at load time.
  const libdir = path.resolve(__dirname, '..', 'lib') + path.sep
  const reload = platform => {
    if (platform)
      process.env.TESTING_TAR_FAKE_PLATFORM = platform
    else
      delete process.env.TESTING_TAR_FAKE_PLATFORM
    Object.keys(require.cache)
      .filter(k => k.indexOf(libdir) === 0)
      .forEach(k => delete require.cache[k])
    return require('../lib/unpack.js')
  }

  t.teardown(_ => {
    rimraf.sync(dir)
    reload(null)
  })

  const setup = leg => {
    const cwd = path.resolve(dir, leg)
    rimraf.sync(cwd)
    mkdirp.sync(cwd)
    return cwd
  }

  const readMaybe = p => {
    try {
      return fs.readFileSync(p, 'utf8')
    } catch (er) {
      return er.code
    }
  }

  const check = (t, cwd, warnings) => {
    t.same(warnings, [], 'no warnings')
    t.equal(readMaybe(cwd + '/a/b/c'), 'x', 'entry landed at a/b/c')
    t.throws(_ => fs.lstatSync(cwd + '/a\\b'), 'no literal a\\b entry')
    t.end()
  }

  t.test('async', t => {
    const WinUnpack = reload('win32')
    const cwd = setup('async')
    const warnings = []
    new WinUnpack({ cwd: cwd })
      .on('warn', msg => warnings.push(msg))
      .on('close', _ => check(t, cwd, warnings))
      .end(data)
  })

  t.test('sync', t => {
    const WinUnpackSync = reload('win32').Sync
    const cwd = setup('sync')
    const warnings = []
    new WinUnpackSync({ cwd: cwd })
      .on('warn', msg => warnings.push(msg))
      .end(data)
    check(t, cwd, warnings)
  })

  t.end()
})

// a windows extraction target on a drive that none of the attack vectors
// name, so path.win32.resolve() of a raw entry path always lands outside it
const winTarget = 'E:\\safety\\land'

// document *why* a raw entry path is dangerous: on windows it resolves
// somewhere other than inside the extraction target.
const assertEscapes = (t, raw) => {
  const resolved = path.win32.resolve(winTarget, raw).toLowerCase()
  const target = winTarget.toLowerCase()
  t.ok(resolved !== target && resolved.indexOf(target + '\\') !== 0,
    raw + ' resolves to ' + resolved + ', outside ' + winTarget)
}

const driveRelativeTar = p => makeTar([
  {
    path: p,
    type: 'File',
    size: 1,
    mode: 0o644,
    mtime: new Date('2011-03-27T22:16:31.000Z')
  },
  'x',
  '',
  ''
])

// CVE-2021-37713: on windows a path like 'c:../foo', 'c:foo' or 'C:some\path'
// is NOT absolute, but it does have a root, so path.resolve() resolves it
// against the current directory of *that drive* instead of against the
// extraction target -- letting an archive write wherever it likes.  The '..'
// check missed the 'c:..' spelling too, because the '..' is glued onto the
// drive letter and so is not a path part of its own.  The fix strips any
// root, absolute or drive-relative, off the entry path first, and only then
// looks for '..' parts in whatever is left.
t.test('drive-relative paths', t => {
  const dir = path.resolve(unpackdir, 'drive-relative')
  t.teardown(_ => rimraf.sync(dir))

  const cases = [
    // the advisory's 'c:../foo' vector, in its posix-separator spelling
    {
      raw: 'c:../system/explorer.exe',
      warning: ['path contains \'..\'', 'c:../system/explorer.exe'],
      lands: null
    },
    // guard: this one has a bare '..' part, so it was already caught
    {
      raw: 'd:../../unsafe/land',
      warning: ['path contains \'..\'', 'd:../../unsafe/land'],
      lands: null
    },
    // 'c:..' is a single path part, so the old '..' check never saw it
    {
      raw: 'c:..',
      warning: ['path contains \'..\'', 'c:..'],
      lands: null
    },
    // no '..' at all, but the drive root still has to come off
    {
      raw: 'c:foo',
      warning: ['stripping c: from absolute path', 'c:foo'],
      lands: 'foo'
    },
    {
      raw: 'D:mark',
      warning: ['stripping D: from absolute path', 'D:mark'],
      lands: 'mark'
    },
    // a drive-relative root hiding behind an absolute one: stripping only
    // the leading '/' leaves 'c:../foo/bar', which escapes all over again
    {
      raw: '/c:../foo/bar',
      warning: ['path contains \'..\'', '/c:../foo/bar'],
      lands: null
    },
    // windows thinks //x/y is the "root" of //x/y/z/a, but that is a made up
    // host and share, so the whole thing is kept, minus the separators
    {
      raw: '//x/y/z/a',
      warning: ['stripping // from absolute path', '//x/y/z/a'],
      lands: 'x/y/z/a'
    },
    // guard: '//?/X:/' is a real root and must be taken off whole, rather
    // than one leading '/' at a time
    {
      raw: '//?/X:/y/z',
      warning: ['stripping //?/X:/ from absolute path', '//?/X:/y/z'],
      lands: 'y/z'
    },
    // CVE-2021-32804: taking one root off '///a/b/c' leaves '//a/b/c', which
    // is still absolute, so a single strip does not sanitize anything
    {
      raw: '///a/b/c',
      warning: ['stripping /// from absolute path', '///a/b/c'],
      lands: 'a/b/c'
    },
    // CVE-2021-32804: same trick with a drive root glued onto itself
    {
      raw: 'c:/c:/foo',
      warning: ['stripping c:/c:/ from absolute path', 'c:/c:/foo'],
      lands: 'foo'
    }
  ]

  const setup = leg => {
    const legdir = path.resolve(dir, leg)
    rimraf.sync(legdir)
    mkdirp.sync(path.resolve(legdir, 'cwd'))
    return legdir
  }

  const check = (t, c, legdir, warnings) => {
    const cwd = path.resolve(legdir, 'cwd')
    assertEscapes(t, c.raw)
    t.strictSame(warnings, [c.warning], 'warned about ' + c.raw)
    if (c.lands === null)
      t.strictSame(fs.readdirSync(cwd), [], 'nothing was extracted')
    else {
      t.strictSame(fs.readdirSync(cwd), [c.lands.split('/')[0]],
        'only the sanitized entry was created')
      t.equal(fs.readFileSync(path.resolve(cwd, c.lands), 'utf8'), 'x',
        'entry body landed at ' + c.lands)
    }
    t.strictSame(fs.readdirSync(legdir), ['cwd'],
      'nothing written beside the extraction target')
    t.end()
  }

  cases.forEach((c, i) => t.test(c.raw, t => {
    const data = driveRelativeTar(c.raw)

    t.test('async', t => {
      const legdir = setup(i + '-async')
      const warnings = []
      new Unpack({
        cwd: path.resolve(legdir, 'cwd'),
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _ => check(t, c, legdir, warnings)).end(data)
    })

    t.test('sync', t => {
      const legdir = setup(i + '-sync')
      const warnings = []
      new UnpackSync({
        cwd: path.resolve(legdir, 'cwd'),
        onwarn: (w, d) => warnings.push([w, d])
      }).end(data)
      check(t, c, legdir, warnings)
    })

    t.end()
  }))

  t.end()
})

// CVE-2021-37713: the advisory spells its vectors with backslashes
// ('C:some\path', 'c:..\system\explorer.exe'), which are only directory
// separators on windows.  Fake the platform so normalize-windows-path turns
// them into '/', and check the drive root still comes off and the '..' is
// still caught.
t.test('drive-relative paths with \\ separators', {
  skip: isWindows && 'fake platform test, run on posix'
}, t => {
  const dir = path.resolve(unpackdir, 'drive-relative-win32')

  const cases = [
    // the advisory's 'C:some\path' vector
    {
      raw: 'C:some\\foo',
      warning: ['stripping C: from absolute path', 'C:some/foo'],
      lands: 'some/foo'
    },
    // the advisory's 'c:..\foo' vector
    {
      raw: 'c:..\\system\\explorer.exe',
      warning: ['path contains \'..\'', 'c:../system/explorer.exe'],
      lands: null
    },
    // guard: a plainly absolute windows path was stripped before the fix too
    {
      raw: 'D:\\unsafe\\land',
      warning: ['stripping D:/ from absolute path', 'D:/unsafe/land'],
      lands: 'unsafe/land'
    }
  ]

  // build the archives with the real posix Header, before faking the platform
  const datas = cases.map(c => driveRelativeTar(c.raw))

  // tap 12 has no t.mock(), so swap the faked platform in and re-require the
  // library with a cleared cache, since normalize-windows-path.js reads the
  // platform once at load time.
  const libdir = path.resolve(__dirname, '..', 'lib') + path.sep
  const reload = platform => {
    if (platform)
      process.env.TESTING_TAR_FAKE_PLATFORM = platform
    else
      delete process.env.TESTING_TAR_FAKE_PLATFORM
    Object.keys(require.cache)
      .filter(k => k.indexOf(libdir) === 0)
      .forEach(k => delete require.cache[k])
    return require('../lib/unpack.js')
  }

  t.teardown(_ => {
    rimraf.sync(dir)
    reload(null)
  })

  const setup = leg => {
    const legdir = path.resolve(dir, leg)
    rimraf.sync(legdir)
    mkdirp.sync(path.resolve(legdir, 'cwd'))
    return legdir
  }

  const check = (t, c, legdir, warnings) => {
    const cwd = path.resolve(legdir, 'cwd')
    assertEscapes(t, c.raw)
    t.strictSame(warnings, [c.warning], 'warned about ' + c.raw)
    if (c.lands === null)
      t.strictSame(fs.readdirSync(cwd), [], 'nothing was extracted')
    else {
      t.strictSame(fs.readdirSync(cwd), [c.lands.split('/')[0]],
        'only the sanitized entry was created')
      t.equal(fs.readFileSync(path.resolve(cwd, c.lands), 'utf8'), 'x',
        'entry body landed at ' + c.lands)
    }
    t.strictSame(fs.readdirSync(legdir), ['cwd'],
      'nothing written beside the extraction target')
    t.end()
  }

  cases.forEach((c, i) => t.test(c.raw, t => {
    t.test('async', t => {
      const WinUnpack = reload('win32')
      const legdir = setup(i + '-async')
      const warnings = []
      new WinUnpack({
        cwd: path.resolve(legdir, 'cwd'),
        onwarn: (w, d) => warnings.push([w, d])
      }).on('close', _ => check(t, c, legdir, warnings)).end(datas[i])
    })

    t.test('sync', t => {
      const WinUnpackSync = reload('win32').Sync
      const legdir = setup(i + '-sync')
      const warnings = []
      new WinUnpackSync({
        cwd: path.resolve(legdir, 'cwd'),
        onwarn: (w, d) => warnings.push([w, d])
      }).end(datas[i])
      check(t, c, legdir, warnings)
    })

    t.end()
  }))

  t.end()
})

// 'café' spelled with a precomposed é, and with an e followed by a combining
// acute accent.  Different bytes, different dirCache keys, but the same file
// on any filesystem that normalizes unicode (and, like an 8.3 shortname on
// windows, indistinguishable from the outside).
const cafeNFC = Buffer.from([0x63, 0x61, 0x66, 0xc3, 0xa9]).toString()
const cafeNFD = Buffer.from([0x63, 0x61, 0x66, 0x65, 0xcc, 0x81]).toString()

// snapshot the dirCache the instant the symlink entry is handled.  This
// listener is added after the one the Unpack constructor installs, so it runs
// right after the entry has been pruned, before the entries that follow can
// put the dropped keys back.
const atSymlink = (unpack, dirCache) => {
  const seen = {}
  unpack.on('entry', entry => {
    if (entry.type === 'SymbolicLink' && !seen.cache)
      seen.cache = new Map(dirCache)
  })
  return seen
}

// CVE-2021-37712: a symlink whose name collides with a directory already in
// the dirCache only once the filesystem squashes unicode normalization (or,
// on windows, 8.3 shortnames) left that directory's key behind when the cache
// was pruned, because the keys were compared byte for byte.  A later entry
// under the directory name then hit the stale key, skipped mkdir()'s symlink
// check, and was written straight through the link -- an arbitrary file write
// outside the extraction target.  The fix drops the whole dirCache as soon as
// any symlink is extracted, and compares the surviving keys on an
// NFKD-normalized, case-folded form.  The escape itself is not reachable on a
// case-sensitive, non-normalizing filesystem, where the two spellings are
// simply two different names, so the dirCache is the assertion.
t.test('dirCache dropped on unicode normalized symlink collision', {
  skip: isWindows && 'symlinks not fully supported'
}, t => {
  const dir = path.resolve(unpackdir, 'dircache-unicode')
  t.teardown(_ => rimraf.sync(dir))

  const data = makeTar([
    {
      path: 'foo',
      type: 'Directory',
      mode: 0o755
    },
    {
      path: 'foo/bar',
      type: 'File',
      size: 1,
      mode: 0o644
    },
    'x',
    {
      path: cafeNFC,
      type: 'Directory',
      mode: 0o755
    },
    {
      path: cafeNFD,
      type: 'SymbolicLink',
      linkpath: 'foo'
    },
    {
      path: cafeNFC + '/bar',
      type: 'File',
      size: 1,
      mode: 0o644
    },
    'y',
    '',
    ''
  ])

  const setup = leg => {
    const cwd = path.resolve(dir, leg)
    rimraf.sync(cwd)
    mkdirp.sync(cwd)
    return cwd
  }

  const check = (t, cwd, dirCache, seen) => {
    t.notOk(seen.cache.has(cwd + '/' + cafeNFC),
      'colliding dir key dropped when the symlink was extracted')
    t.notOk(seen.cache.has(cwd + '/foo'),
      'symlink target key dropped when the symlink was extracted')
    t.notOk(dirCache.has(cwd + '/foo'),
      'dropped key not put back by the entries that follow')
    t.ok(fs.lstatSync(cwd + '/' + cafeNFD).isSymbolicLink(), 'entry is a symlink')
    t.equal(fs.readFileSync(cwd + '/foo/bar', 'utf8'), 'x',
      'nothing written through the symlink')
    t.strictSame(fs.readdirSync(cwd + '/foo'), ['bar'],
      'symlink target untouched')
    t.end()
  }

  t.test('async', t => {
    const cwd = setup('async')
    const dirCache = new Map()
    const u = new Unpack({ cwd: cwd, dirCache: dirCache })
    const seen = atSymlink(u, dirCache)
    u.on('close', _ => check(t, cwd, dirCache, seen)).end(data)
  })

  t.test('sync', t => {
    const cwd = setup('sync')
    const dirCache = new Map()
    const u = new UnpackSync({ cwd: cwd, dirCache: dirCache })
    const seen = atSymlink(u, dirCache)
    u.end(data)
    check(t, cwd, dirCache, seen)
  })

  t.end()
})

// CVE-2021-37712: there is no way to tell from the entry name alone whether a
// symlink collides with something already in the dirCache -- that depends on
// how the filesystem folds case, normalizes unicode, or hands out 8.3
// shortnames.  So the drop cannot be conditional on the name resembling a
// cached key: any symlink at all has to clear the entire cache.
t.test('dirCache dropped for any symlink, not just colliding names', {
  skip: isWindows && 'symlinks not fully supported'
}, t => {
  const dir = path.resolve(unpackdir, 'dircache-any-symlink')
  t.teardown(_ => rimraf.sync(dir))

  const data = makeTar([
    {
      path: 'foo',
      type: 'Directory',
      mode: 0o755
    },
    {
      path: 'foo/bar',
      type: 'File',
      size: 1,
      mode: 0o644
    },
    'x',
    {
      path: 'quux',
      type: 'SymbolicLink',
      linkpath: './elsewhere'
    },
    {
      path: 'baz/qux',
      type: 'File',
      size: 1,
      mode: 0o644
    },
    'z',
    '',
    ''
  ])

  const setup = leg => {
    const cwd = path.resolve(dir, leg)
    rimraf.sync(cwd)
    mkdirp.sync(cwd)
    return cwd
  }

  const check = (t, cwd, dirCache, seen) => {
    t.notOk(seen.cache.has(cwd + '/foo'),
      'unrelated symlink still dropped the whole dirCache')
    t.notOk(dirCache.has(cwd + '/foo'),
      'dropped key not put back by the entries that follow')
    t.ok(fs.lstatSync(cwd + '/quux').isSymbolicLink(), 'entry is a symlink')
    t.equal(fs.readFileSync(cwd + '/foo/bar', 'utf8'), 'x',
      'earlier entry still landed')
    t.equal(fs.readFileSync(cwd + '/baz/qux', 'utf8'), 'z',
      'later entry still landed')
    t.end()
  }

  t.test('async', t => {
    const cwd = setup('async')
    const dirCache = new Map()
    const u = new Unpack({ cwd: cwd, dirCache: dirCache })
    const seen = atSymlink(u, dirCache)
    u.on('close', _ => check(t, cwd, dirCache, seen)).end(data)
  })

  t.test('sync', t => {
    const cwd = setup('sync')
    const dirCache = new Map()
    const u = new UnpackSync({ cwd: cwd, dirCache: dirCache })
    const seen = atSymlink(u, dirCache)
    u.end(data)
    check(t, cwd, dirCache, seen)
  })

  t.end()
})

// CVE-2021-37712: pruning the dirCache for an entry that is no longer a
// directory compared the keys case-insensitively, but two unicode spellings
// of the same name still failed to match each other, leaving stale keys for
// the directory and everything under it.  Keys are now compared on their
// NFKD-normalized, case-folded form.
t.test('prune dirCache on unicode-normalized match', t => {
  const dir = path.resolve(unpackdir, 'dircache-nfkd')
  t.teardown(_ => rimraf.sync(dir))

  const data = makeTar([
    {
      path: cafeNFC + '/bar',
      type: 'Directory',
      mode: 0o755
    },
    {
      path: cafeNFD,
      type: 'File',
      size: 1,
      mode: 0o644
    },
    'x',
    '',
    ''
  ])

  const setup = leg => {
    const cwd = path.resolve(dir, leg)
    rimraf.sync(cwd)
    mkdirp.sync(cwd)
    return cwd
  }

  const check = (t, cwd, dirCache) => {
    t.notOk(dirCache.has(cwd + '/' + cafeNFC),
      'stale dir key pruned across unicode normalization')
    t.notOk(dirCache.has(cwd + '/' + cafeNFC + '/bar'),
      'stale child key pruned across unicode normalization')
    t.equal(fs.readFileSync(cwd + '/' + cafeNFD, 'utf8'), 'x',
      'entry body landed')
    t.end()
  }

  t.test('async', t => {
    const cwd = setup('async')
    const dirCache = new Map()
    new Unpack({ cwd: cwd, dirCache: dirCache })
      .on('close', _ => check(t, cwd, dirCache))
      .end(data)
  })

  t.test('sync', t => {
    const cwd = setup('sync')
    const dirCache = new Map()
    new UnpackSync({ cwd: cwd, dirCache: dirCache }).end(data)
    check(t, cwd, dirCache)
  })

  t.end()
})

// CVE-2024-28863: a single tar entry can name a path nested hundreds of
// thousands of levels deep.  Unpacking it means an mkdir per level, so one
// 450kb archive is enough to keep the process (and the file system) busy for
// a very long time.  Anything deeper than maxDepth is warned about and
// skipped instead, and nothing is written for it at all.
t.test('excessively deep subfolder nesting', t => {
  const dir = path.resolve(unpackdir, 'excessively-deep')
  t.teardown(_ => rimraf.sync(dir))

  const tf = path.resolve(fixtures, 'excessively-deep.tar')
  const data = fs.readFileSync(tf)
  const warnings = []
  const onwarn = (msg, d) => warnings.push([msg, d])

  const setup = leg => {
    const cwd = path.resolve(dir, leg)
    rimraf.sync(cwd)
    mkdirp.sync(cwd)
    return cwd
  }

  const check = (t, cwd, maxDepth) => {
    maxDepth = maxDepth === undefined ? 1024 : maxDepth
    t.equal(warnings.length, 1,
      'exactly one warning, got: ' + warnings.map(w => w[0]).join(' | '))
    const w = warnings[0] || []
    t.equal(w[0], 'excessively deep subfolder nesting')
    const d = w[1] || {}
    t.ok(d.entry instanceof ReadEntry, 'the offending entry is reported')
    t.match(d.path, /^\.(\/a){1024,}\/foo\.txt$/, 'the offending path')
    t.equal(d.depth, 222372, 'the depth of the entry')
    t.equal(d.depth, String(d.path).split('/').length,
      'depth is the path depth')
    t.ok(d.depth > maxDepth, 'the reported depth is over the limit')
    t.equal(d.maxDepth, maxDepth, 'the limit that was exceeded')
    t.strictSame(fs.readdirSync(cwd), [],
      'nothing at all is created in the extraction target')
    warnings.length = 0
    t.end()
  }

  t.test('async', t => {
    const cwd = setup('async')
    new Unpack({
      cwd: cwd,
      onwarn: onwarn
    }).on('end', () => check(t, cwd)).end(data)
  })

  t.test('sync', t => {
    const cwd = setup('sync')
    new UnpackSync({
      cwd: cwd,
      onwarn: onwarn
    }).end(data)
    check(t, cwd)
  })

  t.test('async set md', t => {
    const cwd = setup('async-set-md')
    new Unpack({
      cwd: cwd,
      onwarn: onwarn,
      maxDepth: 64
    }).on('end', () => check(t, cwd, 64)).end(data)
  })

  t.test('sync set md', t => {
    const cwd = setup('sync-set-md')
    new UnpackSync({
      cwd: cwd,
      onwarn: onwarn,
      maxDepth: 64
    }).end(data)
    check(t, cwd, 64)
  })

  t.test('maxDepth: Infinity turns the limit off', t => {
    // The limit is opt-out, so `maxDepth: Infinity` has to skip the depth
    // check entirely and leave a normal archive completely untouched.
    const cwd = setup('unlimited')
    const shallow = makeTar([
      {
        path: 'a/b/c.txt',
        type: 'File',
        size: 1
      },
      'x',
      '',
      ''
    ])
    new Unpack({
      cwd: cwd,
      onwarn: onwarn,
      maxDepth: Infinity
    }).on('end', () => {
      t.strictSame(warnings, [], 'no depth warning with maxDepth: Infinity')
      t.equal(fs.readFileSync(cwd + '/a/b/c.txt', 'utf8'), 'x',
        'the archive is unpacked as usual')
      warnings.length = 0
      t.end()
    }).end(shallow)
  })

  t.end()
})

t.test('linkpath is sanitized like the entry path', {
  skip: isWindows && 'symbolic links are not fully supported on windows'
}, t => {
  // Only entry.path used to be checked for '..' and for an absolute root.
  // The linkpath of a link entry lands on the file system just the same:
  // a hard link's linkpath is resolved with path.resolve(cwd, linkpath),
  // which ignores cwd entirely when the linkpath is absolute, so the link
  // makes a file outside the extraction target writable from inside it;
  // and a symbolic link's linkpath is handed to fs.symlink() verbatim, so
  // an absolute one can be pointed at anywhere on the system.  Both fields
  // now have their root stripped the way entry.path does.  A '..' is refused
  // for entry.path and for a hard link's linkpath; a symbolic link's is left
  // alone, since that is just an ordinary relative link.
  //
  // The names here are kept short on purpose: an absolute linkpath only
  // fits in a tar header up to 100 bytes, and a truncated one would make
  // the hard link miss its target for the wrong reason.
  const base = path.resolve(unpackdir, 'lp')
  const secret = path.resolve(base, 'secret')
  const SECRET = 'ORIGINAL DATA'
  const symTarget = '/some/absolute/path'

  // the failed hard links warn with an fs error that quotes the paths, so
  // pick out only the messages the sanitizer itself emits
  const sanitized = warnings => warnings.filter(w =>
    /^(linkpath contains|stripping .* from absolute linkpath$)/.test(w))

  t.teardown(_ => rimraf.sync(base))

  const data = makeTar([
    {
      path: 'hard_abs',
      type: 'Link',
      linkpath: secret
    },
    {
      path: 'hard_rel',
      type: 'Link',
      linkpath: '../secret'
    },
    {
      path: 'sym_abs',
      type: 'SymbolicLink',
      linkpath: symTarget
    },
    {
      path: 'sym_rel',
      type: 'SymbolicLink',
      linkpath: '../../escape'
    },
    '',
    ''
  ])

  const setup = leg => {
    const cwd = path.resolve(base, leg)
    rimraf.sync(cwd)
    mkdirp.sync(cwd)
    fs.writeFileSync(secret, SECRET)
    return cwd
  }

  const check = (t, cwd, warnings) => {
    t.ok(Buffer.byteLength(secret) < 100,
      'the absolute linkpath fits in the tar header')

    // the root came off the absolute linkpath, so it can only ever resolve
    // inside cwd, where there is nothing to link to; the '..' linkpath was
    // refused outright.  Neither link exists.
    t.throws(_ => fs.lstatSync(cwd + '/hard_abs'), { code: 'ENOENT' },
      'no hard link made to the absolute path outside cwd')
    t.throws(_ => fs.lstatSync(cwd + '/hard_rel'), { code: 'ENOENT' },
      'no hard link made to the ".." path outside cwd')

    // writing where the hard links would have been must not reach the file
    // they were aimed at
    fs.writeFileSync(cwd + '/hard_abs', 'PWNED')
    fs.writeFileSync(cwd + '/hard_rel', 'PWNED')
    t.equal(fs.readFileSync(secret, 'utf8'), SECRET,
      'the file outside the extraction target is not overwritten')

    t.equal(fs.lstatSync(cwd + '/sym_abs').isSymbolicLink(), true,
      'the symbolic link with an absolute target is still created')
    const target = fs.readlinkSync(cwd + '/sym_abs')
    t.ok(target !== symTarget, 'the absolute target is not written verbatim')
    t.equal(path.isAbsolute(target), false, 'the target is relativized')
    t.equal(path.resolve(cwd, target).indexOf(cwd + path.sep), 0,
      'the target stays inside the extraction target')

    t.equal(fs.lstatSync(cwd + '/sym_rel').isSymbolicLink(), true,
      'the symbolic link with a ".." target is created')
    t.equal(fs.readlinkSync(cwd + '/sym_rel'), '../../escape',
      'a relative symbolic link target is left as the archive spelled it')

    t.same(sanitized(warnings), [
      'stripping / from absolute linkpath',
      'linkpath contains \'..\'',
      'stripping / from absolute linkpath'
    ], 'each rewritten or refused linkpath is warned about')
    t.end()
  }

  t.test('async', t => {
    const cwd = setup('async')
    const warnings = []
    new Unpack({ cwd: cwd })
      .on('warn', msg => warnings.push(msg))
      .on('close', _ => check(t, cwd, warnings))
      .end(data)
  })

  t.test('sync', t => {
    const cwd = setup('sync')
    const warnings = []
    new UnpackSync({ cwd: cwd })
      .on('warn', msg => warnings.push(msg))
      .end(data)
    check(t, cwd, warnings)
  })

  t.test('preservePaths leaves the linkpath alone', t => {
    // opting out has to keep working: with preservePaths the linkpath is
    // used exactly as the archive spelled it
    const cwd = setup('preserve')
    const warnings = []
    new UnpackSync({ cwd: cwd, preservePaths: true })
      .on('warn', msg => warnings.push(msg))
      .end(data)
    t.equal(fs.readlinkSync(cwd + '/sym_abs'), symTarget,
      'the absolute symbolic link target is preserved')
    t.equal(fs.readlinkSync(cwd + '/sym_rel'), '../../escape',
      'the ".." symbolic link target is preserved')
    t.same(sanitized(warnings), [], 'no linkpath warnings')
    t.end()
  })

  t.end()
})

t.test('GHSA-34x7-hfp2-rc4v hardlink .. escape', {
  skip: isWindows && 'symbolic links are not fully supported on windows'
}, t => {
  // [HARDLINK] resolves a hard link's linkpath with
  // path.resolve(this.cwd, entry.linkpath): always against the top of the
  // extraction target, never against the directory the entry itself lands
  // in.  So a linkpath that reads as "stays inside" when it is resolved
  // from a deep entry -- 'a/b/c/d/' plus '../../../../secret.txt' is just
  // 'secret.txt' -- is in fact four levels above the extraction target by
  // the time fs.link() runs.  A check that resolved the linkpath from the
  // entry's own directory would wave that one through and hand the archive
  // a hard link, which is a live read/write handle, on a file outside the
  // extraction target.  So every '..' in a hard link's linkpath is refused,
  // however deep the entry sits.
  //
  // A symbolic link's linkpath is only ever the literal contents of the
  // link, so '../sibling' is an ordinary relative symbolic link and is left
  // exactly as the archive spelled it.
  const base = path.resolve(unpackdir, 'ghsa34x7')
  const SECRET = 'ORIGINAL DATA'

  t.teardown(_ => rimraf.sync(base))

  const upDots = up => new Array(up + 1).join('../')

  // the file `up` levels above the extraction target
  const secretAt = (cwd, up) =>
    path.resolve(cwd, upDots(up) + 'secret.txt')

  // entry path in the archive -> how many levels above cwd fs.link() would
  // land.  'deep_hard' is the interesting one: relative to its own folder
  // the linkpath resolves back to the top of the extraction target, so it
  // looks harmless, and only the cwd-relative resolution reveals the escape.
  const hardlinks = [
    ['exploit_hard', 1],
    ['sub/nested_hard', 2],
    ['sub/deeper/mid_hard', 3],
    ['a/b/c/d/deep_hard', 4]
  ]

  const dirs = ['sub/', 'sub/deeper/', 'a/', 'a/b/', 'a/b/c/', 'a/b/c/d/']

  const data = makeTar(dirs.map(d => ({
    path: d,
    type: 'Directory'
  })).concat(hardlinks.map(hl => ({
    path: hl[0],
    type: 'Link',
    linkpath: upDots(hl[1]) + 'secret.txt'
  }))).concat([
    {
      path: 'valid_sym',
      type: 'SymbolicLink',
      linkpath: '../secret.txt'
    },
    {
      path: 'sub/inner_sym',
      type: 'SymbolicLink',
      linkpath: '../../elsewhere'
    },
    '',
    ''
  ]))

  // put the extraction target several folders deep and plant a file at
  // every level one of the linkpaths above walks up to, so each vector has
  // something real to reach for
  const setup = leg => {
    const legRoot = path.resolve(base, leg)
    const cwd = path.resolve(legRoot, 'l4/l3/l2/l1/cwd')
    rimraf.sync(legRoot)
    mkdirp.sync(cwd)
    for (let up = 1; up <= hardlinks.length; up++)
      fs.writeFileSync(secretAt(cwd, up), SECRET)
    return cwd
  }

  const check = (t, cwd, warnings) => {
    hardlinks.forEach(hl => {
      const p = path.resolve(cwd, hl[0])
      t.throws(_ => fs.lstatSync(p), { code: 'ENOENT' },
        'no hard link made for ' + hl[0])
      // writing where the hard link would have been has to make a new file
      // inside cwd, not reach the file the archive aimed at
      fs.writeFileSync(p, 'PWNED')
    })

    for (let up = 1; up <= hardlinks.length; up++) {
      t.equal(fs.readFileSync(secretAt(cwd, up), 'utf8'), SECRET,
        'the file ' + up + ' level(s) above the extraction target is intact')
    }

    t.equal(fs.lstatSync(cwd + '/valid_sym').isSymbolicLink(), true,
      'the relative symbolic link is created')
    t.equal(fs.readlinkSync(cwd + '/valid_sym'), '../secret.txt',
      'its target is left as the archive spelled it')
    t.equal(fs.readlinkSync(cwd + '/sub/inner_sym'), '../../elsewhere',
      'a relative symbolic link in a subfolder is left alone too')

    t.equal(warnings.filter(w => w === 'linkpath contains \'..\'').length,
      hardlinks.length, 'every hard link linkpath is refused')
    t.end()
  }

  t.test('async', t => {
    const cwd = setup('async')
    const warnings = []
    new Unpack({ cwd: cwd })
      .on('warn', msg => warnings.push(msg))
      .on('close', _ => check(t, cwd, warnings))
      .end(data)
  })

  t.test('sync', t => {
    const cwd = setup('sync')
    const warnings = []
    new UnpackSync({ cwd: cwd })
      .on('warn', msg => warnings.push(msg))
      .end(data)
    check(t, cwd, warnings)
  })

  t.end()
})

// CVE-2026-26960: fs.link() and fs.symlink() resolve every directory
// component of the target they are handed, so a symbolic link anywhere along
// a link entry's linkpath makes the new link name a live handle on a file
// outside the extraction target -- even though the linkpath itself holds no
// '..' and no absolute root for the linkpath sanitizer to catch, and even
// though the entry's own path never leaves cwd.
//
// The chain here is spelled entirely with symbolic links the archive itself
// creates, so a single tar file is the whole exploit: 'a/b/up' -> '../..'
// points back at the top of the extraction target, so 'a/b/escape' -> 'up/..'
// points at its *parent*.  Nothing about either linkpath looks like an escape,
// because path.resolve() collapses 'up/..' lexically back to 'a/b' and never
// asks the file system what 'up' really is.  Only walking the linkpath
// component by component and refusing any symbolic link found along it closes
// that off.  The symbolic links themselves are still created -- only linking
// *through* one is refused.
t.test('no linking through a symbolic link', {
  skip: isWindows && 'symbolic links are not fully supported on windows'
}, t => {
  const base = path.resolve(unpackdir, 'link-through-symlink')
  const VICTIM = 'original content'
  t.teardown(_ => rimraf.sync(base))

  // the extraction target is 'x', and the file the archive is really after
  // sits beside it, one level above the extraction target
  const setup = leg => {
    const root = path.resolve(base, leg)
    rimraf.sync(root)
    mkdirp.sync(path.resolve(root, 'x'))
    fs.writeFileSync(path.resolve(root, 'exploited-file'), VICTIM)
    return root
  }

  const tar = type => makeTar([
    {
      path: 'a/b/up',
      type: 'SymbolicLink',
      linkpath: '../..',
      mode: 0o755
    },
    {
      path: 'a/b/escape',
      type: 'SymbolicLink',
      linkpath: 'up/..',
      mode: 0o755
    },
    {
      path: 'exploit',
      type: type,
      linkpath: 'a/b/escape/exploited-file',
      mode: 0o755
    },
    '',
    ''
  ])

  const check = (t, root, warnings) => {
    const cwd = path.resolve(root, 'x')
    const victim = path.resolve(root, 'exploited-file')

    t.equal(fs.lstatSync(cwd + '/a/b/up').isSymbolicLink(), true,
      'the first symbolic link of the chain is still created')
    t.equal(fs.lstatSync(cwd + '/a/b/escape').isSymbolicLink(), true,
      'the second symbolic link of the chain is still created')
    // the chain really does land outside the extraction target: ask the
    // kernel, by writing through it.  path.resolve() -- and node's own
    // fs.realpathSync(), which starts by resolving lexically -- collapse
    // 'up/..' back to 'a/b' and never look at what 'up' is, which is exactly
    // what makes the linkpath look clean.
    fs.writeFileSync(cwd + '/a/b/escape/probe', 'x')
    t.equal(fs.readFileSync(root + '/probe', 'utf8'), 'x',
      'the symbolic link chain resolves outside the extraction target')

    t.throws(_ => fs.lstatSync(cwd + '/exploit'), { code: 'ENOENT' },
      'no link made through the symbolic link')

    // had the link been made, this write would have gone straight through it
    // and landed on the file outside the extraction target
    fs.writeFileSync(cwd + '/exploit', 'PWNED')
    t.equal(fs.readFileSync(victim, 'utf8'), VICTIM,
      'the file outside the extraction target is not written to')

    t.equal(warnings.length, 1,
      'exactly one warning, got: ' + warnings.join(' | '))
    t.match(warnings[0], /Cannot extract through symbolic link/,
      'refused because of the symbolic link')
    t.end()
  }

  const types = ['Link', 'SymbolicLink']
  types.forEach(type => {
    t.test(type, t => {
      const data = tar(type)

      t.test('async', t => {
        const root = setup('async-' + type)
        const warnings = []
        new Unpack({
          cwd: path.resolve(root, 'x'),
          onwarn: (w, d) => warnings.push(w)
        }).on('close', _ => check(t, root, warnings)).end(data)
      })

      t.test('sync', t => {
        const root = setup('sync-' + type)
        const warnings = []
        new UnpackSync({
          cwd: path.resolve(root, 'x'),
          onwarn: (w, d) => warnings.push(w)
        }).end(data)
        check(t, root, warnings)
      })

      t.end()
    })
  })

  t.test('preservePaths opts out', t => {
    // preservePaths means "do exactly what the archive says", so the walk has
    // to be skipped entirely and the link made through the symbolic link
    const checkMade = (t, root, warnings) => {
      const cwd = path.resolve(root, 'x')
      t.same(warnings, [], 'no warnings')
      t.equal(fs.readFileSync(cwd + '/exploit', 'utf8'), VICTIM,
        'the link was made through the symbolic link')
      t.end()
    }

    t.test('async', t => {
      const root = setup('preserve-async')
      const warnings = []
      new Unpack({
        cwd: path.resolve(root, 'x'),
        preservePaths: true,
        onwarn: (w, d) => warnings.push(w)
      }).on('close', _ => checkMade(t, root, warnings)).end(tar('Link'))
    })

    t.test('sync', t => {
      const root = setup('preserve-sync')
      const warnings = []
      new UnpackSync({
        cwd: path.resolve(root, 'x'),
        preservePaths: true,
        onwarn: (w, d) => warnings.push(w)
      }).end(tar('SymbolicLink'))
      checkMade(t, root, warnings)
    })

    t.end()
  })

  t.end()
})

// CVE-2026-26960: the same hazard with a single symbolic link that is already
// sitting in the extraction target when the archive is unpacked -- left there
// by an earlier archive, or by anything else on the system.  The archive is
// then a one-entry file whose linkpath, 'x/victim.txt', holds no '..' and no
// root at all, so there is nothing about it for the linkpath sanitizer to
// object to; only walking it and finding that 'x' is a symbolic link does.
t.test('no linking through a symbolic link already on disk', {
  skip: isWindows && 'symbolic links are not fully supported on windows'
}, t => {
  const base = path.resolve(unpackdir, 'link-through-planted-symlink')
  const VICTIM = 'original content'
  t.teardown(_ => rimraf.sync(base))

  // 'x' is a symbolic link inside the extraction target pointing at a
  // directory outside of it
  const setup = leg => {
    const root = path.resolve(base, leg)
    rimraf.sync(root)
    const cwd = path.resolve(root, 'cwd')
    const outside = path.resolve(root, 'outside')
    mkdirp.sync(cwd)
    mkdirp.sync(outside)
    fs.writeFileSync(path.resolve(outside, 'victim.txt'), VICTIM)
    fs.symlinkSync(outside, path.resolve(cwd, 'x'))
    return root
  }

  const tar = type => makeTar([
    {
      path: 'exploit',
      type: type,
      linkpath: 'x/victim.txt',
      mode: 0o755
    },
    '',
    ''
  ])

  const check = (t, root, warnings) => {
    const cwd = path.resolve(root, 'cwd')
    const victim = path.resolve(root, 'outside', 'victim.txt')

    t.equal(fs.lstatSync(cwd + '/x').isSymbolicLink(), true,
      'the symbolic link in the way is left alone')
    t.throws(_ => fs.lstatSync(cwd + '/exploit'), { code: 'ENOENT' },
      'no link made through the symbolic link')

    // had the link been made, this write would have gone straight through it
    // and landed on the file outside the extraction target
    fs.writeFileSync(cwd + '/exploit', 'PWNED')
    t.equal(fs.readFileSync(victim, 'utf8'), VICTIM,
      'the file outside the extraction target is not written to')

    t.equal(warnings.length, 1,
      'exactly one warning, got: ' + warnings.join(' | '))
    t.match(warnings[0], /Cannot extract through symbolic link/,
      'refused because of the symbolic link')
    t.end()
  }

  const types = ['Link', 'SymbolicLink']
  types.forEach(type => {
    t.test(type, t => {
      const data = tar(type)

      t.test('async', t => {
        const root = setup('async-' + type)
        const warnings = []
        new Unpack({
          cwd: path.resolve(root, 'cwd'),
          onwarn: (w, d) => warnings.push(w)
        }).on('close', _ => check(t, root, warnings)).end(data)
      })

      t.test('sync', t => {
        const root = setup('sync-' + type)
        const warnings = []
        new UnpackSync({
          cwd: path.resolve(root, 'cwd'),
          onwarn: (w, d) => warnings.push(w)
        }).end(data)
        check(t, root, warnings)
      })

      t.end()
    })
  })

  t.end()
})

// CVE-2026-31802: a symbolic link's linkpath is allowed to keep its '..' --
// '../sibling' is an ordinary relative symbolic link and the sanitizer leaves
// it alone on purpose.  But a rooted linkpath such as 'c:../../../../foo/bar'
// (a windows drive-relative path, which has a root without being absolute) has
// that root taken off first, and what is left is still handed to fs.symlink()
// verbatim and resolved against the directory the entry lands in.  So an
// archive can spell an escaping target as a rooted one, walk straight past the
// '..' rule -- which only refuses entry paths and hard links -- and end up with
// a symbolic link *inside* the extraction target that points outside of it: a
// live read/write handle on any file the archive names.  Once a root has been
// stripped off a linkpath, the remainder has to be resolved from the entry's
// own directory and refused when it lands outside.
t.test('CVE-2026-31802 rooted symlink linkpath escaping extraction dir', {
  skip: isWindows && 'symbolic links are not fully supported on windows'
}, t => {
  const base = path.resolve(unpackdir, 'rooted-symlink-escape')
  const VICTIM = 'ORIGINAL DATA'
  t.teardown(_ => rimraf.sync(base))

  // The extraction target sits four folders deep, so every vector has real
  // directories to walk up through and a real file waiting where it lands:
  //
  //   <legdir>/w/x/y/z   <- cwd
  //
  // entry:    the name the link would be created under, inside cwd
  // link:     what the archive spells, root and all
  // win:      the same target spelled with windows separators
  // victim:   path, relative to legdir, of the file the link resolves to
  // through:  what to write, relative to cwd, to go through the link
  const vectors = [
    {
      // resolved from cwd/a, the four '..' land on <legdir>/w
      entry: 'a/esc_deep',
      link: 'c:../../../../foo/bar',
      win: 'c:..\\..\\..\\..\\foo\\bar',
      victim: 'w/foo/bar',
      through: 'a/esc_deep'
    },
    {
      // the bare case: the link points straight at cwd's parent, so anything
      // written through it lands beside the extraction target
      entry: 'esc_bare',
      link: 'c:..',
      win: 'c:..',
      victim: 'w/x/y/victim.txt',
      through: 'esc_bare/victim.txt'
    },
    {
      // doubly rooted ('/c:'), resolved from cwd/a/b
      entry: 'a/b/esc_double',
      link: '/c:../../../foo/baz',
      win: '\\c:..\\..\\..\\foo\\baz',
      victim: 'w/x/y/foo/baz',
      through: 'a/b/esc_double'
    }
  ]

  // ...and the guard must not be over-broad.  A rooted linkpath whose '..'
  // still lands inside the extraction target is only stripped, as before, and
  // a rootless relative one is not touched at all.
  const okRooted = {
    entry: 'a/b/ok_root',
    link: 'c:../ok/target',
    win: 'c:..\\ok\\target',
    reads: '../ok/target'
  }
  const okPlain = {
    entry: 'plain_rel',
    link: '../sibling',
    reads: '../sibling'
  }

  // three refusals, then the safe rooted linkpath stripped the way it always
  // was; the rootless relative one says nothing at all
  const expectWarnings = [
    'linkpath escapes extraction directory',
    'linkpath escapes extraction directory',
    'linkpath escapes extraction directory',
    'stripping c: from absolute linkpath'
  ]

  const tar = (spelling, oks) => makeTar(vectors.map(v => ({
    path: v.entry,
    type: 'SymbolicLink',
    linkpath: v[spelling]
  })).concat(oks.map(ok => ({
    path: ok.entry,
    type: 'SymbolicLink',
    linkpath: ok[spelling] || ok.link
  }))).concat([
    '',
    ''
  ]))

  const setup = leg => {
    const legdir = path.resolve(base, leg)
    rimraf.sync(legdir)
    mkdirp.sync(path.resolve(legdir, 'w/x/y/z'))
    // plant a file at every location an escaping linkpath resolves to, so
    // each vector has something real to reach for
    vectors.forEach(v => {
      const victim = path.resolve(legdir, v.victim)
      mkdirp.sync(path.dirname(victim))
      fs.writeFileSync(victim, VICTIM)
    })
    return legdir
  }

  const check = (t, legdir, warnings, oks) => {
    const cwd = path.resolve(legdir, 'w/x/y/z')

    vectors.forEach(v => {
      t.throws(_ => fs.lstatSync(path.resolve(cwd, v.entry)),
        { code: 'ENOENT' }, 'no symbolic link made for ' + v.entry)
      // had the link been made, this write would have gone straight through
      // it and landed on the file outside the extraction target.  It either
      // fails outright or makes an ordinary file inside cwd; both are fine.
      try {
        fs.writeFileSync(path.resolve(cwd, v.through), '+PWNED')
      } catch (er) {}
      t.equal(fs.readFileSync(path.resolve(legdir, v.victim), 'utf8'), VICTIM,
        'the file outside the extraction target is intact: ' + v.victim)
    })

    oks.forEach(ok => {
      t.equal(fs.lstatSync(path.resolve(cwd, ok.entry)).isSymbolicLink(), true,
        ok.entry + ' is still created')
      t.equal(fs.readlinkSync(path.resolve(cwd, ok.entry)), ok.reads,
        ok.entry + ' keeps the target the sanitizer left it')
    })

    t.strictSame(warnings, expectWarnings,
      'each escaping linkpath refused, the safe rooted one only stripped')
    t.end()
  }

  t.test('posix spelling', t => {
    const oks = [okRooted, okPlain]
    const data = tar('link', oks)

    t.test('async', t => {
      const legdir = setup('async')
      const warnings = []
      new Unpack({
        cwd: path.resolve(legdir, 'w/x/y/z'),
        onwarn: (w, d) => warnings.push(w)
      }).on('close', _ => check(t, legdir, warnings, oks)).end(data)
    })

    t.test('sync', t => {
      const legdir = setup('sync')
      const warnings = []
      new UnpackSync({
        cwd: path.resolve(legdir, 'w/x/y/z'),
        onwarn: (w, d) => warnings.push(w)
      }).end(data)
      check(t, legdir, warnings, oks)
    })

    t.end()
  })

  // the same vectors as the advisory spells them, with \ separators, which are
  // only directory separators on windows.  Fake the platform so
  // normalize-windows-path turns them into '/', the way it would there.
  t.test('windows \\ spelling', t => {
    const oks = [okRooted]
    // build the archive with the real posix Header, before faking the platform
    const data = tar('win', oks)

    // tap 12 has no t.mock(), so swap the faked platform in and re-require the
    // library with a cleared cache, since normalize-windows-path.js reads the
    // platform once at load time.
    const libdir = path.resolve(__dirname, '..', 'lib') + path.sep
    const reload = platform => {
      if (platform)
        process.env.TESTING_TAR_FAKE_PLATFORM = platform
      else
        delete process.env.TESTING_TAR_FAKE_PLATFORM
      Object.keys(require.cache)
        .filter(k => k.indexOf(libdir) === 0)
        .forEach(k => delete require.cache[k])
      return require('../lib/unpack.js')
    }

    t.teardown(_ => reload(null))

    t.test('async', t => {
      const WinUnpack = reload('win32')
      const legdir = setup('win-async')
      const warnings = []
      new WinUnpack({
        cwd: path.resolve(legdir, 'w/x/y/z'),
        onwarn: (w, d) => warnings.push(w)
      }).on('close', _ => check(t, legdir, warnings, oks)).end(data)
    })

    t.test('sync', t => {
      const WinUnpackSync = reload('win32').Sync
      const legdir = setup('win-sync')
      const warnings = []
      new WinUnpackSync({
        cwd: path.resolve(legdir, 'w/x/y/z'),
        onwarn: (w, d) => warnings.push(w)
      }).end(data)
      check(t, legdir, warnings, oks)
    })

    t.end()
  })

  t.test('preservePaths leaves the escaping linkpath alone', t => {
    // opting out has to keep working: with preservePaths the linkpath is used
    // exactly as the archive spelled it, escape and all
    const oks = [okRooted, okPlain]
    const legdir = setup('preserve')
    const cwd = path.resolve(legdir, 'w/x/y/z')
    const warnings = []
    new UnpackSync({
      cwd: cwd,
      preservePaths: true,
      onwarn: (w, d) => warnings.push(w)
    }).end(tar('link', oks))
    vectors.forEach(v => {
      t.equal(fs.readlinkSync(path.resolve(cwd, v.entry)), v.link,
        'the escaping target of ' + v.entry + ' is preserved')
    })
    t.strictSame(warnings, [], 'no linkpath warnings')
    t.end()
  })

  t.end()
})