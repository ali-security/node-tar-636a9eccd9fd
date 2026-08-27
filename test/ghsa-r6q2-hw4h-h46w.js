'use strict'

// GHSA-r6q2-hw4h-h46w / CVE-2026-23950
//
// macOS's APFS (and HFS+) fold a handful of unicode characters onto their
// expanded spelling, so 'ß' and 'SS', or 'ﬀ' and 'FF', are one and the same
// name on disk.  tar has to compare paths the way the file system does, or an
// archive can hand it two entries it believes are unrelated while the file
// system quietly maps them onto a single directory entry -- letting a symbolic
// link stand in for a path tar still has cached as a real directory.
//
// The dirCache keys used to be folded with NFKD + toLowerCase(), which leaves
// 'ß' and 'SS' looking like two unrelated paths.  normalize-unicode.js folds
// with NFD + toLocaleLowerCase('en') + toLocaleUpperCase('en') instead, which
// collapses them the same way the file system does.

const t = require('tap')
const path = require('path')
const fs = require('fs')
const mkdirp = require('mkdirp')
const rimraf = require('rimraf')

const Unpack = require('../lib/unpack.js')
const UnpackSync = Unpack.Sync
const extract = require('../lib/extract.js')
const makeTar = require('./make-tar.js')
const normalizeUnicode = require('../lib/normalize-unicode.js')

const dir = path.resolve(__dirname, 'fixtures/ghsa-r6q2-hw4h-h46w')
t.teardown(_ => rimraf.sync(dir))

const testdir = leg => {
  const d = path.resolve(dir, leg)
  rimraf.sync(d)
  mkdirp.sync(d)
  return d
}

// [the character, the spelling the file system folds it onto].
// Written as pairs rather than an object so the order is fixed and the legs
// can be named after the index.
const chars = [
  ['ﬀ', 'FF'],
  ['ﬁ', 'FI'],
  ['ﬂ', 'FL'],
  ['ﬃ', 'FFI'],
  ['ﬄ', 'FFL'],
  ['ﬅ', 'ST'],
  ['ﬆ', 'ST'],
  ['ẛ', 'S\u0307'],
  ['ß', 'SS'],
  ['ẞ', 'SS'],
  ['ſ', 'S']
]

chars.forEach((pair, i) => {
  const c = pair[0]
  const n = pair[1]
  const name = 'U+' + ('000' + c.charCodeAt(0).toString(16)).slice(-4).toUpperCase()

  t.test(name + ' collides with ' + JSON.stringify(n), t => {
    t.equal(normalizeUnicode(c), n,
      'folds onto the spelling the file system uses')

    t.test('link then file', t => {
      const cwd = testdir(i + '-link-then-file')
      const file = path.resolve(cwd, 'tarball')
      fs.writeFileSync(file, makeTar([
        { path: c, type: 'SymbolicLink', linkpath: './target' },
        { path: n, type: 'File', size: 1 },
        'x',
        '',
        ''
      ]))
      extract({ cwd: cwd, file: file, sync: true })
      t.throws(_ => fs.statSync(path.resolve(cwd, 'target')),
        'nothing was written through the symbolic link')
      t.equal(fs.readFileSync(path.resolve(cwd, n), 'utf8'), 'x',
        'the file landed under its own name')
      t.end()
    })

    t.test('file then link', t => {
      const cwd = testdir(i + '-file-then-link')
      const file = path.resolve(cwd, 'tarball')
      fs.writeFileSync(file, makeTar([
        { path: n, type: 'File', size: 1 },
        'x',
        { path: c, type: 'SymbolicLink', linkpath: './target' },
        '',
        ''
      ]))
      extract({ cwd: cwd, file: file, sync: true })
      t.throws(_ => fs.statSync(path.resolve(cwd, 'target')),
        'nothing was written through the symbolic link')
      t.equal(fs.lstatSync(path.resolve(cwd, c)).isSymbolicLink(), true,
        'the link landed under its own name')
      t.end()
    })

    t.end()
  })
})

// The extraction legs above only bite on a file system that actually folds
// these names together, so they cannot prove the fix on ext4.  This one can:
// the dirCache is pure bookkeeping inside Unpack, so the collision is
// observable everywhere.  A directory tar just created has to be evicted from
// the cache as soon as an entry that the file system will fold onto it arrives
// -- otherwise tar keeps trusting a cached directory that something else has
// since taken over.  With the old NFKD + toLowerCase() keys, 'ß' and 'SS'
// never matched and the stale directory survived.
t.test('a colliding entry evicts the cached directory', t => {
  const run = (leg, second) => {
    const cwd = testdir(leg)
    const dirCache = new Map()
    new UnpackSync({ cwd: cwd, dirCache: dirCache }).end(makeTar([
      { path: 'ß', type: 'Directory', mode: 0o755 },
      { path: second, type: 'File', size: 1, mode: 0o644 },
      'x',
      '',
      ''
    ]))
    return dirCache.has(path.resolve(cwd, 'ß'))
  }

  t.equal(run('dircache-collide', 'SS'), false,
    'the ß directory is evicted when an SS entry lands on top of it')
  t.equal(run('dircache-distinct', 'TT'), true,
    'an entry that does not collide leaves the ß directory cached')
  t.end()
})
