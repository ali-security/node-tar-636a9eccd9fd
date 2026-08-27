'use strict'
const t = require('tap')
const list = require('../lib/list.js')
const path = require('path')
const fs = require('fs')
const mutateFS = require('mutate-fs')
const makeTar = require('./make-tar.js')

t.test('basic', t => {
  const file = path.resolve(__dirname, 'fixtures/tars/long-paths.tar')
  const expect = require('./fixtures/parse/long-paths.json').filter(
    e => Array.isArray(e) && e[0] === 'entry'
  ).map(e => e[1].path)

  const check = (actual, t) => {
    t.same(actual, expect)
    return Promise.resolve(null)
  }

  ;[1000, null].forEach(maxReadSize => {
    t.test('file maxReadSize=' + maxReadSize, t => {
      t.test('sync', t => {
        const actual = []
        const onentry = entry => actual.push(entry.path)
        list({
          file: file,
          sync: true,
          onentry: onentry,
          maxReadSize: maxReadSize
        })
        return check(actual, t)
      })

      t.test('async promise', t => {
        const actual = []
        const onentry = entry => actual.push(entry.path)
        return list({
          file: file,
          onentry: onentry,
          maxReadSize: maxReadSize
        }).then(_ => check(actual, t))
      })

      t.test('async cb', t => {
        const actual = []
        const onentry = entry => actual.push(entry.path)
        list({
          file: file,
          onentry: onentry,
          maxReadSize: maxReadSize
        }, er => {
          if (er)
            throw er
          check(actual, t)
          t.end()
        })
      })
      t.end()
    })
  })

  t.test('stream', t => {
    t.test('sync', t => {
      const actual = []
      const onentry = entry => actual.push(entry.path)
      const l = list({ sync: true, onentry: onentry })
      l.end(fs.readFileSync(file))
      return check(actual, t)
    })

    t.test('async', t => {
      const actual = []
      const onentry = entry => actual.push(entry.path)
      const l = list()
      l.on('entry', onentry)
      l.on('end', _ => check(actual, t).then(_ => t.end()))
      fs.createReadStream(file).pipe(l)
    })
    t.end()
  })

  t.test('no onentry function', t => list({ file: file }))

  t.test('limit to specific files', t => {
    const fileList = [
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t',
      '170-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc///'
    ]

    const expect = [
      '170-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/a.txt',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t/h/Ω.txt'
    ]

    t.test('no filter function', t => {
      const check = _ => t.same(actual, expect)
      const actual = []
      return list({
        file: file,
        onentry: entry => actual.push(entry.path)
      }, fileList).then(check)
    })

    t.test('no filter function, stream', t => {
      const check = _ => t.same(actual, expect)
      const actual = []
      const onentry = entry => actual.push(entry.path)
      fs.createReadStream(file).pipe(list(fileList)
        .on('entry', onentry)
        .on('end', _ => {
          check()
          t.end()
        }))
    })

    t.test('filter function', t => {
      const check = _ => t.same(actual, expect.slice(0, 1))
      const actual = []
      return list({
        file: file,
        filter: path => path === expect[0],
        onentry: entry => actual.push(entry.path)
      }, fileList).then(check)
    })

    return t.test('list is unmunged', t => {
      t.same(fileList, [
        'long-path/r/e/a/l/l/y/-/d/e/e/p/-/f/o/l/d/e/r/-/p/a/t',
        '170-byte-filename-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc///'
      ])
      t.end()
    })
  })

  t.end()
})

t.test('bad args', t => {
  t.throws(_ => list({ file: __filename, sync: true }, _ => _),
           new TypeError('callback not supported for sync tar functions'))
  t.throws(_ => list(_=>_),
           new TypeError('callback only supported with file option'))
  t.end()
})

t.test('stat fails', t => {
  const poop = new Error('poop')
  t.teardown(mutateFS.statFail(poop))
  t.test('sync', t => {
    t.plan(1)
    t.throws(_ => list({ file: __filename, sync: true }), poop)
  })
  t.test('cb', t => {
    t.plan(1)
    list({ file: __filename }, er => t.equal(er, poop))
  })
  t.test('promise', t => {
    t.plan(1)
    list({ file: __filename }).catch(er => t.equal(er, poop))
  })
  t.end()
})

t.test('read fail', t => {
  t.test('sync', t => {
    const poop = new Error('poop')
    t.teardown(mutateFS.fail('read', poop))
    t.plan(1)
    t.throws(_ => list({
      file: __filename,
      sync: true,
      maxReadSize: 10
    }), poop)
  })
  t.test('cb', t => {
    const poop = new Error('poop')
    t.teardown(mutateFS.fail('read', poop))
    t.plan(1)
    list({ file: __filename }, er => t.equal(er, poop))
  })
  t.test('promise', t => {
    const poop = new Error('poop')
    t.teardown(mutateFS.fail('read', poop))
    t.plan(1)
    list({ file: __filename }).catch(er => t.equal(er, poop))
  })
  t.end()
})

t.test('noResume option', t => {
  const file = path.resolve(__dirname, 'fixtures/tars/file.tar')
  t.test('sync', t => {
    let e
    list({
      file: file,
      onentry: entry => {
        e = entry
        process.nextTick(_ => {
          t.notOk(entry.flowing)
          entry.resume()
        })
      },
      sync: true,
      noResume: true
    })
    t.ok(e)
    t.notOk(e.flowing)
    e.on('end', _ => t.end())
  })

  t.test('async', t => {
    let e
    return list({
      file: file,
      onentry: entry => {
        process.nextTick(_ => {
          t.notOk(entry.flowing)
          entry.resume()
        })
      },
      noResume: true
    })
  })

  t.end()
})

// GHSA-r292-9mhp-454m: a crafted GNU 'L' or PAX 'x' long-path header can hand
// the parser an entry path made of thousands of segments.  When a file list is
// in play, the filter installed by filesFilter() walks that path upward one
// path.dirname() at a time, so an unbounded walk dies of a RangeError deep
// inside Parser[CONSUMEHEADER] -- long before any other path check sees it.
// The filter is exactly the closure filesFilter() installs, so calling it
// directly reaches the recursion without having to smuggle a deep path through
// a tar header (which cannot carry one, see the next test).
t.test('deeply nested entry path does not overflow the stack', t => {
  const deepPath = new Array(20000).join('a/') + 'a'
  t.equal(deepPath.split('/').length, 20000, '20000 path segments')

  t.test('no filter function', t => {
    const p = list({}, ['some/other/path'])
    t.equal(typeof p.filter, 'function', 'the file list installed a filter')
    let threw = null
    let ret = null
    try {
      ret = p.filter(deepPath, {})
    } catch (er) {
      threw = er
    }
    t.equal(threw, null, 'no RangeError escaped the filter')
    t.equal(ret, false, 'deeply nested entry is not selected')
    t.end()
  })

  t.test('filter function', t => {
    const p = list({ filter: _ => true }, ['some/other/path'])
    let threw = null
    let ret = null
    try {
      ret = p.filter(deepPath, {})
    } catch (er) {
      threw = er
    }
    t.equal(threw, null, 'no RangeError escaped the filter')
    t.equal(ret, false, 'deeply nested entry is not selected')
    t.end()
  })

  t.end()
})

t.test('nested but sane paths are still listed', t => {
  // 45 segments is deep enough to exercise the upward walk and shallow enough
  // that a tar header can actually carry the path: Header.encode() silently
  // truncates anything that fits neither the 100 byte name field nor the 155
  // byte prefix, so assert the round trip rather than trusting it.
  const deepPath = new Array(45).join('a/') + 'a'
  t.equal(deepPath.split('/').length, 45, '45 path segments')
  t.ok(deepPath.length < 100, 'fits in the header path field')

  const data = makeTar([
    { path: deepPath, type: 'File', size: 0 },
    '',
    ''
  ])

  t.test('exact match', t => {
    const listed = []
    const p = list({ onentry: entry => listed.push(entry.path) }, [deepPath])
    p.on('end', _ => {
      t.same(listed, [deepPath], 'listed, and the path was not truncated')
      t.end()
    })
    p.end(data)
  })

  t.test('matched through an ancestor in the list', t => {
    const listed = []
    const p = list({ onentry: entry => listed.push(entry.path) }, ['a'])
    p.on('end', _ => {
      t.same(listed, [deepPath], 'listed by walking up to the listed root')
      t.end()
    })
    p.end(data)
  })

  t.end()
})
