'use strict'
const t = require('tap')
const Pax = require('../lib/pax.js')

t.test('create a pax', t => {
  const p = new Pax({
    atime: new Date('1979-07-01T19:10:00.000Z'),
    ctime: new Date('1979-07-01T19:10:00.000Z'),
    mtime: new Date('1979-07-01T19:10:00.000Z'),
    gid: 20,
    gname: 'staff',
    uid: 24561,
    uname: 'isaacs',
    path: 'foo.txt',
    size: 100,
    dev: 123456,
    ino: 7890,
    nlink: 1,
  })

  // console.log(p.encode().toString('hex').split('').reduce((s,c)=>{if(s[s.length-1].length<64)s[s.length-1]+=c;else s.push(c);return s},['']))

  const buf = Buffer.from(
    // pax entry header
    '5061784865616465722f666f6f2e747874000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000030303036343420003035373736312000303030303234200030303030' +
    '3030303330342000323136373231373631302000303136373332200078000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0075737461720030306973616163730000000000000000000000000000000000' +
    '0000000000000000007374616666000000000000000000000000000000000000' +
    '0000000000000000003030303030302000303030303030200000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000032313637' +
    '3231373631302000323136373231373631302000000000000000000000000000' +

    // entry body
    '313620706174683d666f6f2e7478740a3139206374696d653d32393937303432' +
    '30300a3139206174696d653d3239393730343230300a323120534348494c592e' +
    '6465763d3132333435360a313920534348494c592e696e6f3d373839300a3138' +
    '20534348494c592e6e6c696e6b3d310a39206769643d32300a313520676e616d' +
    '653d73746166660a3139206d74696d653d3239393730343230300a3132207369' +
    '7a653d3130300a3133207569643d32343536310a313620756e616d653d697361' +
    '6163730a00000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000',
    'hex')

  const actual = p.encode()
  t.equal(actual.toString('hex'), buf.toString('hex'))
  t.end()
})

t.test('null pax', t => {
  const p = new Pax({})
  t.equal(p.encode(), null)
  t.end()
})

t.test('tiny pax', t => {
  // weird to have a global setting a path.  Maybe this should be
  // an error?
  const p = new Pax({path: 'ab'}, true)
  const actual = p.encode()
  // console.log(actual.toString('hex').split('').reduce((s,c)=>{if(s[s.length-1].length<64)s[s.length-1]+=c;else s.push(c);return s},['']))
  // return Promise.resolve()

  const buf = Buffer.from(
    // header
    '5061784865616465722f61620000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000030303036343420000000000000000000000000000000000030303030' +
    '3030303031332000000000000000000000000000303037303534200067000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0075737461720030300000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000003030303030302000303030303030200000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +

    // body
    // note that a 2-char path is 11, but a 1 char path is 9, because
    // adding the second char bumps the n to 10, which adds 1, which
    // means it has to be 11.
    // a 1-char path COULD be encoded as EITHER "10 path=x\n", or as
    // "9 path=x\n", and it'd be true either way.
    '313120706174683d61620a000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000' +
    '0000000000000000000000000000000000000000000000000000000000000000',
    'hex')

  t.equal(actual.toString('hex'), buf.toString('hex'))

  t.end()
})

t.test('parse', t => {
  t.same(Pax.parse('11 path=ab\n', { uid: 24561 }, true), {
    atime: null,
    charset: null,
    comment: null,
    ctime: null,
    gid: null,
    gname: null,
    linkpath: null,
    mtime: null,
    path: 'ab',
    size: null,
    uid: 24561,
    uname: null,
    dev: null,
    ino: null,
    nlink: null,
    global: true
  })

  t.same(Pax.parse('11 path=ab\n', null, false), {
    atime: null,
    charset: null,
    comment: null,
    ctime: null,
    gid: null,
    gname: null,
    linkpath: null,
    mtime: null,
    path: 'ab',
    size: null,
    uid: null,
    uname: null,
    dev: null,
    ino: null,
    nlink: null,
    global: false
  })

  t.same(Pax.parse('9 gid=20\n9 path=x\n', null, false), {
    atime: null,
    charset: null,
    comment: null,
    ctime: null,
    gid: 20,
    gname: null,
    linkpath: null,
    mtime: null,
    path: 'x',
    size: null,
    uid: null,
    uname: null,
    dev: null,
    ino: null,
    nlink: null,
    global: false
  })

  t.same(Pax.parse('9 gid=20\n9 path=x\n', null, false), {
    atime: null,
    charset: null,
    comment: null,
    ctime: null,
    gid: 20,
    gname: null,
    linkpath: null,
    mtime: null,
    path: 'x',
    size: null,
    uid: null,
    uname: null,
    dev: null,
    ino: null,
    nlink: null,
    global: false
  })

  // test that null just safely terminates the value
  t.same(Pax.parse('12 path=x\0y\n', null, false), {
    atime: null,
    charset: null,
    comment: null,
    ctime: null,
    gid: null,
    gname: null,
    linkpath: null,
    mtime: null,
    path: 'x',
    size: null,
    uid: null,
    uname: null,
    dev: null,
    ino: null,
    nlink: null,
    global: false
  })

  t.same(Pax.parse('20 mtime=1491436800\n', null, false), {
    atime: null,
    charset: null,
    comment: null,
    ctime: null,
    gid: null,
    gname: null,
    linkpath: null,
    mtime: new Date('2017-04-06'),
    path: null,
    size: null,
    uid: null,
    uname: null,
    dev: null,
    ino: null,
    nlink: null,
    global: false
  })

  const breaky =
    '93 NODETAR.package.readme=karma-moment\n' +
    '=================\n' +
    '\n' +
    'Karma plugin for Moment framework\n' +
    '\n'

  const noKey = '10 =pathx\n'

  t.same(Pax.parse(breaky + '9 gid=20\n10 path=x\n'+noKey, null, false), {
    atime: null,
    charset: null,
    comment: null,
    ctime: null,
    gid: 20,
    gname: null,
    linkpath: null,
    mtime: null,
    path: 'x',
    size: null,
    uid: null,
    uname: null,
    dev: null,
    ino: null,
    nlink: null,
    global: false
  })



  t.end()
})

t.test('string fields stay string', t => {
  // The type of a pax value used to be guessed from the shape of the value:
  // anything made up only of digits came back as a Number.  A path or linkpath
  // of '12345' is a perfectly ordinary file name, and handing it back as the
  // Number 12345 breaks every string operation done on it downstream.
  const parsed = Pax.parse(
    '14 path=12345\n18 linkpath=54321\n13 WAT=12345\n15 ctime=12345\n',
    null, false)

  t.equal(parsed.path, '12345')
  t.equal(typeof parsed.path, 'string', 'path is a string, not a number')
  t.equal(parsed.linkpath, '54321')
  t.equal(typeof parsed.linkpath, 'string', 'linkpath is a string, not a number')
  t.same(parsed.ctime, new Date('1970-01-01T03:25:45.000Z'))
  t.equal(parsed.atime, null)
  t.equal(parsed.charset, null)
  t.equal(parsed.comment, null)
  t.equal(parsed.gid, null)
  t.equal(parsed.gname, null)
  t.equal(parsed.mtime, null)
  t.equal(parsed.size, null)
  t.equal(parsed.uid, null)
  t.equal(parsed.uname, null)
  t.equal(parsed.dev, null)
  t.equal(parsed.ino, null)
  t.equal(parsed.nlink, null)
  t.equal(parsed.global, false)
  t.equal(parsed.WAT, undefined, 'unknown keys are not picked up')

  t.end()
})

t.test('each known field is read as the type it is defined to have', t => {
  // Pax.parse merges the raw key/value set it parsed into the object handed to
  // it as the second argument, so passing a bare object exposes the parse
  // itself -- including the fields the Pax constructor does not keep.
  const parseRaw = line => {
    const raw = {}
    Pax.parse(line, raw, false)
    return raw
  }

  // the length prefix counts its own digits, so it has to be resolved against
  // itself, exactly the way Pax#encodeField writes it
  const paxLine = (k, v) => {
    const s = ' ' + k + '=' + v + '\n'
    const byteLen = Buffer.byteLength(s)
    let digits = Math.floor(Math.log(byteLen) / Math.log(10)) + 1
    if (byteLen + digits >= Math.pow(10, digits))
      digits += 1
    return (digits + byteLen) + s
  }

  // every value below is spelled so that guessing the type from its shape
  // would get it wrong
  const value = '12345'

  const stringFields =
    ['path', 'linkpath', 'type', 'charset', 'comment', 'gname', 'uname']
  stringFields.forEach(k => {
    const raw = parseRaw(paxLine(k, value))
    t.equal(raw[k], value, k + ' keeps the value it was given')
    t.equal(typeof raw[k], 'string', k + ' is a string')
  })

  const dateFields = ['atime', 'mtime', 'ctime']
  dateFields.forEach(k => {
    const raw = parseRaw(paxLine(k, value))
    t.ok(raw[k] instanceof Date, k + ' is a Date')
    t.equal(raw[k].getTime(), 12345000, k + ' is read as epoch seconds')
  })

  const numberFields = ['gid', 'uid', 'dev', 'ino', 'nlink', 'size', 'mode']
  numberFields.forEach(k => {
    const raw = parseRaw(paxLine(k, value))
    t.equal(raw[k], 12345, k + ' keeps the value it was given')
    t.equal(typeof raw[k], 'number', k + ' is a number')
  })

  // SCHILY.dev/ino/nlink are the spellings tar writes these three under
  const schilyFields = ['dev', 'ino', 'nlink']
  schilyFields.forEach(k => {
    const raw = parseRaw(paxLine('SCHILY.' + k, value))
    t.equal(raw[k], 12345, 'SCHILY.' + k + ' is read as ' + k)
  })

  // a key tar does not know about is dropped, rather than guessed at
  const unknown = parseRaw(paxLine('WAT', value))
  t.same(Object.keys(unknown), [], 'nothing is set for an unknown key')

  t.end()
})

t.test('no negative size', t => {
  // a negative size makes the entry body length negative, so nothing is ever
  // consumed from the stream and the parser spins on the same block forever.
  // refuse it at the point it is read, rather than carrying it any further.
  const neg = Pax.parse('14 size=-1000\n')
  t.same(neg, {
    atime: null,
    charset: null,
    comment: null,
    ctime: null,
    gid: null,
    gname: null,
    linkpath: null,
    mtime: null,
    path: null,
    size: null,
    uid: null,
    uname: null,
    dev: null,
    ino: null,
    nlink: null,
    global: false
  })
  // t.same is loose, so pin the one field this is about strictly
  t.equal(neg.size, null, 'a negative size is not set at all')

  const pos = Pax.parse('13 size=1000\n')
  t.equal(pos.size, 1000, 'a valid size is still read')
  t.equal(typeof pos.size, 'number', 'and it is still a number')
  t.end()
})
