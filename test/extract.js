'use strict'

const t = require('tap')
const x = require('../lib/extract.js')
const path = require('path')
const fs = require('fs')
const extractdir = path.resolve(__dirname, 'fixtures/extract')
const tars = path.resolve(__dirname, 'fixtures/tars')
const mkdirp = require('mkdirp')
const rimraf = require('rimraf')
const mutateFS = require('mutate-fs')
const makeTar = require('./make-tar.js')
const Pax = require('../lib/pax.js')

t.teardown(_ => rimraf.sync(extractdir))

t.test('basic extracting', t => {
  const file = path.resolve(tars, 'utf8.tar')
  const dir = path.resolve(extractdir, 'basic')

  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const check = t => {
    fs.lstatSync(dir + '/Ω.txt')
    fs.lstatSync(dir + '/🌟.txt')
    t.throws(_ => fs.lstatSync(dir + '/long-path/r/e/a/l/l/y/-/d/e/e/p/-' +
                               '/f/o/l/d/e/r/-/p/a/t/h/Ω.txt'))

    rimraf.sync(dir)
    t.end()
  }

  const files = [ '🌟.txt', 'Ω.txt' ]
  t.test('sync', t => {
    x({ file: file, sync: true, C: dir }, files)
    check(t)
  })

  t.test('async promisey', t => {
    return x({ file: file, cwd: dir }, files).then(_ => {
      check(t)
    })
  })

  t.test('async cb', t => {
    return x({ file: file, cwd: dir }, files, er => {
      if (er)
        throw er
      check(t)
    })
  })

  t.end()
})

t.test('file list and filter', t => {
  const file = path.resolve(tars, 'utf8.tar')
  const dir = path.resolve(extractdir, 'filter')

  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const check = t => {
    fs.lstatSync(dir + '/Ω.txt')
    t.throws(_ => fs.lstatSync(dir + '/🌟.txt'))
    t.throws(_ => fs.lstatSync(dir + '/long-path/r/e/a/l/l/y/-/d/e/e/p/-' +
                               '/f/o/l/d/e/r/-/p/a/t/h/Ω.txt'))

    rimraf.sync(dir)
    t.end()
  }

  const filter = path => path === 'Ω.txt'

  t.test('sync', t => {
    x({ filter: filter, file: file, sync: true, C: dir }, [ '🌟.txt', 'Ω.txt' ])
    check(t)
  })

  t.test('async promisey', t => {
    return x({ filter: filter, file: file, cwd: dir }, [ '🌟.txt', 'Ω.txt' ]).then(_ => {
      check(t)
    })
  })

  t.test('async cb', t => {
    return x({ filter: filter, file: file, cwd: dir }, [ '🌟.txt', 'Ω.txt' ], er => {
      if (er)
        throw er
      check(t)
    })
  })

  t.end()
})

t.test('no file list', t => {
  const file = path.resolve(tars, 'body-byte-counts.tar')
  const dir = path.resolve(extractdir, 'no-list')

  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const check = t => {
    t.equal(fs.lstatSync(path.resolve(dir, '1024-bytes.txt')).size, 1024)
    t.equal(fs.lstatSync(path.resolve(dir, '512-bytes.txt')).size, 512)
    t.equal(fs.lstatSync(path.resolve(dir, 'one-byte.txt')).size, 1)
    t.equal(fs.lstatSync(path.resolve(dir, 'zero-byte.txt')).size, 0)
    rimraf.sync(dir)
    t.end()
  }

  t.test('sync', t => {
    x({ file: file, sync: true, C: dir })
    check(t)
  })

  t.test('async promisey', t => {
    return x({ file: file, cwd: dir }).then(_ => {
      check(t)
    })
  })

  t.test('async cb', t => {
    return x({ file: file, cwd: dir }, er => {
      if (er)
        throw er
      check(t)
    })
  })

  t.end()
})

t.test('read in itty bits', t => {
  const maxReadSize = 1000
  const file = path.resolve(tars, 'body-byte-counts.tar')
  const dir = path.resolve(extractdir, 'no-list')

  t.beforeEach(cb => {
    rimraf.sync(dir)
    mkdirp.sync(dir)
    cb()
  })

  const check = t => {
    t.equal(fs.lstatSync(path.resolve(dir, '1024-bytes.txt')).size, 1024)
    t.equal(fs.lstatSync(path.resolve(dir, '512-bytes.txt')).size, 512)
    t.equal(fs.lstatSync(path.resolve(dir, 'one-byte.txt')).size, 1)
    t.equal(fs.lstatSync(path.resolve(dir, 'zero-byte.txt')).size, 0)
    rimraf.sync(dir)
    t.end()
  }

  t.test('sync', t => {
    x({ file: file, sync: true, C: dir, maxReadSize: maxReadSize })
    check(t)
  })

  t.test('async promisey', t => {
    return x({ file: file, cwd: dir, maxReadSize: maxReadSize }).then(_ => {
      check(t)
    })
  })

  t.test('async cb', t => {
    return x({ file: file, cwd: dir, maxReadSize: maxReadSize }, er => {
      if (er)
        throw er
      check(t)
    })
  })

  t.end()
})

t.test('bad calls', t => {
  t.throws(_=> x(_=>_))
  t.throws(_=> x({sync: true}, _=>_))
  t.throws(_=> x({sync: true}, [], _=>_))
  t.end()
})

t.test('no file', t => {
  const Unpack = require('../lib/unpack.js')
  t.isa(x(), Unpack)
  t.isa(x(['asdf']), Unpack)
  t.isa(x({sync:true}), Unpack.Sync)
  t.end()
})

t.test('nonexistent', t => {
  t.throws(_ => x({sync: true, file: 'does not exist' }))
  x({ file: 'does not exist' }).catch(_ => t.end())
})

t.test('read fail', t => {
  const poop = new Error('poop')
  t.teardown(mutateFS.fail('read', poop))

  t.throws(_ => x({maxReadSize: 10, sync: true, file: __filename }), poop)
  t.end()
})

t.test('sync gzip error edge case test', t => {
  const zlib = require('minizlib')
  const file = path.resolve(__dirname, 'fixtures/sync-gzip-fail.tgz')
  const dir = path.resolve(__dirname, 'sync-gzip-fail')
  const cwd = process.cwd()
  mkdirp.sync(dir + '/x')
  process.chdir(dir)
  t.teardown(() => {
    process.chdir(cwd)
    rimraf.sync(dir)
  })

  x({
    sync: true,
    file: file,
    onwarn: (m, er) => { throw er }
  })

  t.same(fs.readdirSync(dir + '/x').sort(),
    [ '1', '10', '2', '3', '4', '5', '6', '7', '8', '9' ])

  t.end()
})

// CVE-2026-59871: a pax header path made up only of digits -- '12345', a
// perfectly ordinary file name -- used to be handed back as the Number 12345,
// because the type of a pax value was guessed from the shape of the value.
// Extraction then does string work on a number and the entry never lands.
t.test('numeric pax/entry name discernment', t => {
  const numericName = '12345'
  const alphaName = 'abcde'
  const body = '12345\n'
  const names = [numericName, alphaName]
  const stricts = [true, false]

  const setup = (leg, data) => {
    const dir = path.resolve(extractdir, 'paxname-' + leg)
    rimraf.sync(dir)
    mkdirp.sync(dir)
    fs.writeFileSync(path.resolve(dir, 'tarFile'), data)
    return dir
  }

  const tarData = (paxName, entryName) => makeTar([
    new Pax({
      path: paxName,
      size: body.length
    }, false).encode(),
    {
      type: 'File',
      path: entryName,
      mode: 0o755,
      ctime: new Date('2000-01-01T00:00:00.000Z'),
      mtime: new Date('2000-01-01T00:00:00.000Z'),
      size: body.length
    },
    body,
    '',
    '',
    // an encoded pax header is two blocks from a single chunk, and makeTar
    // sizes the concatenation by the chunk count -- one more chunk keeps the
    // trailing EOF blocks from being clipped off the end
    ''
  ])

  const check = (t, dir, paxName) => {
    t.equal(fs.readFileSync(path.resolve(dir, paxName), 'utf8'), body,
      'the pax path was used as the string it is')
  }

  stricts.forEach(strict => {
    t.test('strict=' + strict, t => {
      names.forEach(paxName => {
        t.test('paxName=' + paxName, t => {
          names.forEach(entryName => {
            t.test('entryName=' + entryName, t => {
              const data = tarData(paxName, entryName)
              const leg = strict + '-' + paxName + '-' + entryName

              t.test('sync', t => {
                const dir = setup(leg + '-sync', data)
                x({
                  strict: strict,
                  sync: true,
                  cwd: dir,
                  file: path.resolve(dir, 'tarFile')
                })
                check(t, dir, paxName)
                t.end()
              })

              t.test('async', t => {
                const dir = setup(leg + '-async', data)
                x({
                  strict: strict,
                  cwd: dir,
                  file: path.resolve(dir, 'tarFile')
                }).then(_ => {
                  check(t, dir, paxName)
                  t.end()
                }, er => {
                  t.error(er)
                  t.end()
                })
              })

              t.end()
            })
          })
          t.end()
        })
      })
      t.end()
    })
  })

  t.end()
})
