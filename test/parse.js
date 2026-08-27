'use strict'
const t = require('tap')
const Parse = require('../lib/parse.js')

const makeTar = require('./make-tar.js')
const fs = require('fs')
const path = require('path')
const tardir = path.resolve(__dirname, 'fixtures/tars')
const zlib = require('zlib')
const MiniPass = require('minipass')
const Header = require('../lib/header.js')
const Pax = require('../lib/pax.js')
const EE = require('events').EventEmitter

t.test('fixture tests', t => {
  class ByteStream extends MiniPass {
    write (chunk) {
      for (let i = 0; i < chunk.length - 1; i++) {
        super.write(chunk.slice(i, i + 1))
      }
      return super.write(chunk.slice(chunk.length - 1, chunk.length))
    }
  }

  const trackEvents = (t, expect, p, slow) => {
    let ok = true
    let cursor = 0
    p.on('entry', entry => {
      ok = ok && t.match(['entry', entry], expect[cursor++], entry.path)
      if (slow)
        setTimeout(_ => entry.resume())
      else
        entry.resume()
    })
    p.on('ignoredEntry', entry => {
      ok = ok && t.match(['ignoredEntry', entry], expect[cursor++],
                         'ignored: ' + entry.path)
    })
    p.on('warn', (message, data) => {
      ok = ok && t.match(['warn', message], expect[cursor++], 'warn')
    })
    p.on('nullBlock', _ => {
      ok = ok && t.match(['nullBlock'], expect[cursor++], 'null')
    })
    p.on('error', er => {
      ok = ok && t.match(['error', er], expect[cursor++], 'error')
    })
    p.on('meta', meta => {
      ok = ok && t.match(['meta', meta], expect[cursor++], 'meta')
    })
    p.on('end', _ => {
      ok = ok && t.match(['end'], expect[cursor++], 'end')
      t.end()
    })
  }

  t.jobs = 4
  const path = require('path')
  const tardir = path.resolve(__dirname, 'fixtures/tars')
  const parsedir = path.resolve(__dirname, 'fixtures/parse')
  const files = fs.readdirSync(tardir)
  const maxMetaOpt = [250, null]
  const filterOpt = [ true, false ]
  const strictOpt = [ true, false ]
  const runTest = (file, maxMeta, filter, strict) => {
    const tardata = fs.readFileSync(file)
    const base = path.basename(file, '.tar')
    t.test('file=' + base + '.tar' +
           ' maxmeta=' + maxMeta +
           ' filter=' + filter +
           ' strict=' + strict, t => {

      const o =
        (maxMeta ? '-meta-' + maxMeta : '') +
        (filter ? '-filter' : '') +
        (strict ? '-strict' : '')
      const tail = (o ? '-' + o : '') + '.json'
      const eventsFile = parsedir + '/' + base + tail
      const expect = require(eventsFile)

      t.test('one byte at a time', t => {
        const bs = new ByteStream
        const opt = (maxMeta || filter || strict) ? {
          maxMetaEntrySize: maxMeta,
          filter: filter ? (path, entry) => entry.size % 2 !== 0 : null,
          strict: strict
        } : null
        const bp = new Parse(opt)
        trackEvents(t, expect, bp)
        bs.pipe(bp)
        bs.end(tardata)
      })

      t.test('all at once', t => {
        const p = new Parse({
          maxMetaEntrySize: maxMeta,
          filter: filter ? (path, entry) => entry.size % 2 !== 0 : null,
          strict: strict
        })
        trackEvents(t, expect, p)
        p.end(tardata)
      })

      t.test('gzipped all at once', t => {
        const p = new Parse({
          maxMetaEntrySize: maxMeta,
          filter: filter ? (path, entry) => entry.size % 2 !== 0 : null,
          strict: strict
        })
        trackEvents(t, expect, p)
        p.end(zlib.gzipSync(tardata))
      })

      t.test('gzipped byte at a time', t => {
        const bs = new ByteStream
        const gz = new zlib.Gzip()
        const bp = new Parse({
          maxMetaEntrySize: maxMeta,
          filter: filter ? (path, entry) => entry.size % 2 !== 0 : null,
          strict: strict
        })
        trackEvents(t, expect, bp)
        bs.pipe(bp)
        bs.end(zlib.gzipSync(tardata))
      })

      t.test('async chunks', t => {
        const p = new Parse({
          maxMetaEntrySize: maxMeta,
          filter: filter ? (path, entry) => entry.size % 2 !== 0 : null,
          strict: strict
        })
        trackEvents(t, expect, p, true)
        p.write(tardata.slice(0, Math.floor(tardata.length/2)))
        process.nextTick(_ => p.end(tardata.slice(Math.floor(tardata.length/2))))
      })

      t.end()
    })
  }

  files
  .map(f => path.resolve(tardir, f)).forEach(file =>
    maxMetaOpt.forEach(maxMeta =>
      strictOpt.forEach(strict =>
        filterOpt.forEach(filter =>
          runTest(file, maxMeta, filter, strict)))))
  t.end()
})

t.test('strict warn with an error emits that error', t => {
  const p = new Parse({ strict: true })
  const er = new Error('yolo')
  p.on('error', emitted => {
    t.equal(emitted, er)
    t.end()
  })
  p.warn(er.message, er)
})

t.test('onwarn gets added to the warn event', t => {
  t.plan(1)
  const p = new Parse({ onwarn: message => t.equal(message, 'this is fine') })
  p.warn('this is fine')
})

t.test('onentry gets added to entry event', t => {
  t.plan(1)
  const p = new Parse({
    onentry: entry => t.equal(entry, 'yes hello this is dog')
  })
  p.emit('entry', 'yes hello this is dog')
})

t.test('drain event timings', t => {
  // write 1 header and body, write 2 header, verify false return
  // wait for drain event before continuing.
  // write 2 body, 3 header and body, 4 header, verify false return
  // wait for drain event
  // write 4 body and null blocks

  const data = [
    [
      {
        path: 'one',
        size: 513,
        type: 'File'
      },
      new Array(513).join('1'),
      '1',
      {
        path: 'two',
        size: 513,
        type: 'File'
      },
      new Array(513).join('2'),
      '2',
      {
        path: 'three',
        size: 1024,
        type: 'File'
      }
    ],
    [
      new Array(513).join('3'),
      new Array(513).join('3'),
      {
        path: 'four',
        size: 513,
        type: 'File'
      }
    ],
    [
      new Array(513).join('4'),
      '4',
      {
        path: 'five',
        size: 1024,
        type: 'File'
      },
      new Array(513).join('5'),
      new Array(513).join('5'),
      {
        path: 'six',
        size: 1024,
        type: 'File'
      },
      new Array(513).join('6'),
      new Array(513).join('6'),
      {
        path: 'seven',
        size: 1024,
        type: 'File'
      },
      new Array(513).join('7'),
      new Array(513).join('7'),
      {
        path: 'eight',
        size: 1024,
        type: 'File'
      },
      new Array(513).join('8'),
      new Array(513).join('8'),
      {
        path: 'four',
        size: 513,
        type: 'File'
      },
      new Array(513).join('4'),
      '4',
      {
        path: 'five',
        size: 1024,
        type: 'File'
      },
      new Array(513).join('5'),
      new Array(513).join('5'),
      {
        path: 'six',
        size: 1024,
        type: 'File'
      },
      new Array(513).join('6'),
      new Array(513).join('6'),
      {
        path: 'seven',
        size: 1024,
        type: 'File'
      },
      new Array(513).join('7'),
      new Array(513).join('7'),
      {
        path: 'eight',
        size: 1024,
        type: 'File'
      },
      new Array(513).join('8')
    ],
    [
      new Array(513).join('8'),
      {
        path: 'nine',
        size: 1537,
        type: 'File'
      },
      new Array(513).join('9')
    ],
    [ new Array(513).join('9') ],
    [ new Array(513).join('9') ],
    [ '9' ]
  ].map(chunks => makeTar(chunks))

  const expect = [
    'one', 'two', 'three',
    'four', 'five', 'six', 'seven', 'eight',
    'four', 'five', 'six', 'seven', 'eight',
    'nine',
    'one', 'two', 'three',
    'four', 'five', 'six', 'seven', 'eight',
    'four', 'five', 'six', 'seven', 'eight',
    'nine'
  ]

  class SlowStream extends EE {
    write () {
      setTimeout(_ => this.emit('drain'))
      return false
    }
    end () { return this.write() }
  }

  let currentEntry
  let autoPipe = true
  const p = new Parse({
    onentry: entry => {
      t.equal(entry.path, expect.shift())
      currentEntry = entry
      if (autoPipe)
        setTimeout(_=> entry.pipe(new SlowStream()))
    }
  })

  data.forEach(d => {
    if (!t.equal(p.write(d), false, 'write should return false'))
      return t.end()
  })

  let interval
  const go = _ => {
    const d = data.shift()
    if (d === undefined)
      return p.end()

    let paused
    if (currentEntry) {
      currentEntry.pause()
      paused = true
    }

    const hunklen = Math.floor(d.length / 2)
    const hunks = [
      d.slice(0, hunklen),
      d.slice(hunklen)
    ]
    p.write(hunks[0])

    if (currentEntry && !paused) {
      console.error('has current entry')
      currentEntry.pause()
      paused = true
    }

    if (!t.equal(p.write(hunks[1]), false, 'write should return false: ' + d))
      return t.end()

    p.once('drain', go)

    if (paused)
      currentEntry.resume()
  }

  p.once('drain', go)
  p.on('end', _ => {
    clearInterval(interval)
    t.end()
  })
  go()
})

t.test('consume while consuming', t => {
  const data = makeTar([
    {
      path: 'one',
      size: 0,
      type: 'File'
    },
    {
      path: 'zero',
      size: 0,
      type: 'File'
    },
    {
      path: 'two',
      size: 513,
      type: 'File'
    },
    new Array(513).join('2'),
    '2',
    {
      path: 'three',
      size: 1024,
      type: 'File'
    },
    new Array(513).join('3'),
    new Array(513).join('3'),
    {
      path: 'zero',
      size: 0,
      type: 'File'
    },
    {
      path: 'zero',
      size: 0,
      type: 'File'
    },
    {
      path: 'four',
      size: 1024,
      type: 'File'
    },
    new Array(513).join('4'),
    new Array(513).join('4'),
    {
      path: 'zero',
      size: 0,
      type: 'File'
    },
    {
      path: 'zero',
      size: 0,
      type: 'File'
    },
  ])


  const runTest = (t, size) => {
    const p = new Parse()
    const first = data.slice(0, size)
    const rest = data.slice(size)
    p.once('entry', entry => {
      for (let pos = 0; pos < rest.length; pos += size) {
        p.write(rest.slice(pos, pos + size))
      }
      p.end()
    })
    .on('entry', entry => entry.resume())
    .on('end', _ => t.end())
    .write(first)
  }

  // one that aligns, and another that doesn't, so that we
  // get some cases where there's leftover chunk and a buffer
  t.test('size=1000', t => runTest(t, 1000))
  t.test('size=1024', t => runTest(t, 4096))
  t.end()
})

t.test('truncated input', t => {
  const data = makeTar([
    {
      path: 'foo/',
      type: 'Directory'
    },
    {
      path: 'foo/bar',
      type: 'File',
      size: 18
    }
  ])

  t.test('truncated at block boundary', t => {
    const warnings = []
    const p = new Parse({ onwarn: message => warnings.push(message) })
    p.end(data)
    t.same(warnings, [
      'Truncated input (needed 512 more bytes, only 0 available)'
    ])
    t.end()
  })

  t.test('truncated mid-block', t => {
    const warnings = []
    const p = new Parse({ onwarn: message => warnings.push(message) })
    p.write(data)
    p.end(Buffer.from('not a full block'))
    t.same(warnings, [
      'Truncated input (needed 512 more bytes, only 16 available)'
    ])
    t.end()
  })

  t.end()
})

t.test('truncated gzip input', t => {
  const raw = makeTar([
    {
      path: 'foo/',
      type: 'Directory'
    },
    {
      path: 'foo/bar',
      type: 'File',
      size: 18
    },
    new Array(19).join('x'),
    '',
    ''
  ])
  const tgz = zlib.gzipSync(raw)
  const split = Math.floor(tgz.length * 2 / 3)
  const trunc = tgz.slice(0, split)

  const skipEarlyEnd = process.version.match(/^v4\./)
  t.test('early end', {
    skip: skipEarlyEnd ? 'not a zlib error on v4' : false
  }, t => {
    const warnings = []
    const p = new Parse()
    p.on('error', er => warnings.push(er.message))
    let aborted = false
    p.on('abort', _ => aborted = true)
    p.end(trunc)
    t.equal(aborted, true, 'aborted writing')
    t.same(warnings, [ 'zlib: unexpected end of file' ])
    t.end()
  })

  t.test('just wrong', t => {
    const warnings = []
    const p = new Parse()
    p.on('error', er => warnings.push(er.message))
    let aborted = false
    p.on('abort', _ => aborted = true)
    p.write(trunc)
    p.write(trunc)
    p.write(tgz.slice(split))
    p.end()
    t.equal(aborted, true, 'aborted writing')
    t.same(warnings, [ 'zlib: incorrect data check' ])
    t.end()
  })

  t.end()
})

t.test('end while consuming', t => {
  // https://github.com/npm/node-tar/issues/157
  const data = zlib.gzipSync(makeTar([
    {
      path: 'package/package.json',
      type: 'File',
      size: 130
    },
    new Array(131).join('x'),
    {
      path: 'package/node_modules/@c/d/node_modules/e/package.json',
      type: 'File',
      size: 30
    },
    new Array(31).join('e'),
    {
      path: 'package/node_modules/@c/d/package.json',
      type: 'File',
      size: 33
    },
    new Array(34).join('d'),
    {
      path: 'package/node_modules/a/package.json',
      type: 'File',
      size: 59
    },
    new Array(60).join('a'),
    {
      path: 'package/node_modules/b/package.json',
      type: 'File',
      size: 30
    },
    new Array(31).join('b'),
    '',
    ''
  ]))

  const actual = []
  const expect = [
    'package/package.json',
    'package/node_modules/@c/d/node_modules/e/package.json',
    'package/node_modules/@c/d/package.json',
    'package/node_modules/a/package.json',
    'package/node_modules/b/package.json'
  ]

  const mp = new MiniPass()
  const p = new Parse({
    onentry: entry => {
      actual.push(entry.path)
      entry.resume()
    },
    onwarn: er => t.fail(er),
    onerror: er => t.threw(er)
  })
  p.on('end', () => {
    t.same(actual, expect)
    t.end()
  })
  mp.end(data)
  mp.pipe(p)
})

// CVE-2026-53655 - tar interpretation conflict / file smuggling.
//
// A PAX extended header describes the *next file entry*, not the extension
// headers that may sit between it and that entry.  Honoring its fields on an
// intervening `x`/`g`/`L`/`K` block makes this parser see a different archive
// than gnu tar, bsdtar, libarchive and python's tarfile do.
t.test('CVE-2026-53655', t => {
  t.test('pax size does not resize a gnu long-path header', t => {
    // `x(size=1024)` -> `L` -> file.  A vulnerable parser stretches the
    // long-path block from 1 body block to 2, swallowing the file header
    // that follows it, so the file every other tar reports is smuggled past.
    const paxBody = new Pax({ size: 1024 }).encodeBody()
    const data = makeTar([
      {
        path: 'PaxHeader/innocent.txt',
        type: 'ExtendedHeader',
        size: paxBody.length
      },
      paxBody,
      {
        path: '././@LongLink',
        type: 'NextFileHasLongPath',
        size: 512
      },
      'smuggled/evil.txt',
      {
        path: 'innocent.txt',
        type: 'File',
        size: 1024
      },
      new Array(513).join('a'),
      new Array(513).join('b'),
      '',
      ''
    ])

    const entries = []
    const warnings = []
    const p = new Parse({
      onwarn: msg => warnings.push(msg),
      onentry: entry => {
        entries.push([entry.path, entry.size])
        entry.resume()
      }
    })
    p.on('end', _ => {
      t.same(warnings, [], 'stream stayed in sync')
      t.same(entries, [['smuggled/evil.txt', 1024]],
             'long path applies to the file, not to the long-path header')
      t.end()
    })
    p.end(data)
  })

  t.test('pax size does not hide a meta entry behind maxMetaEntrySize', t => {
    // `x(size=1200)` -> `L` -> file, with maxMetaEntrySize=600.  A vulnerable
    // parser gives the long-path block the pax size, decides it is too big to
    // read, and drops the long path - reporting `innocent.txt` for an entry
    // that every other tar extracts as `smuggled/evil.txt`.
    const paxBody = new Pax({ size: 1200 }).encodeBody()
    const data = makeTar([
      {
        path: 'PaxHeader/innocent.txt',
        type: 'ExtendedHeader',
        size: paxBody.length
      },
      paxBody,
      {
        path: '././@LongLink',
        type: 'NextFileHasLongPath',
        size: 512
      },
      'smuggled/evil.txt',
      {
        path: 'innocent.txt',
        type: 'File',
        size: 1200
      },
      new Array(513).join('a'),
      new Array(513).join('b'),
      new Array(513).join('c'),
      '',
      ''
    ])

    const entries = []
    const ignored = []
    const warnings = []
    const p = new Parse({
      maxMetaEntrySize: 600,
      onwarn: msg => warnings.push(msg),
      onentry: entry => {
        entries.push([entry.path, entry.size])
        entry.resume()
      }
    })
    p.on('ignoredEntry', entry => ignored.push(entry.path))
    p.on('end', _ => {
      t.same(warnings, [], 'stream stayed in sync')
      t.same(ignored, [], 'the long-path header is read, not skipped')
      t.same(entries, [['smuggled/evil.txt', 1200]],
             'long path applies to the file')
      t.end()
    })
    p.end(data)
  })

  t.test('global pax size does not resize a gnu long-path header', t => {
    // Same primitive through a *global* extended header, which is never
    // cleared: `g(size=1024)` -> `L` -> file.  One block at the front of the
    // archive is enough to stretch every long-path header that follows it.
    const paxBody = new Pax({ size: 1024 }, true).encodeBody()
    const data = makeTar([
      {
        path: 'PaxHeader/global',
        type: 'GlobalExtendedHeader',
        size: paxBody.length
      },
      paxBody,
      {
        path: '././@LongLink',
        type: 'NextFileHasLongPath',
        size: 512
      },
      'smuggled/evil.txt',
      {
        path: 'innocent.txt',
        type: 'File',
        size: 1024
      },
      new Array(513).join('a'),
      new Array(513).join('b'),
      '',
      ''
    ])

    const entries = []
    const warnings = []
    const p = new Parse({
      onwarn: msg => warnings.push(msg),
      onentry: entry => {
        entries.push([entry.path, entry.size])
        entry.resume()
      }
    })
    p.on('end', _ => {
      t.same(warnings, [], 'stream stayed in sync')
      t.same(entries, [['smuggled/evil.txt', 1024]],
             'global header applies to the file, not to the long-path header')
      t.end()
    })
    p.end(data)
  })

  t.end()
})
