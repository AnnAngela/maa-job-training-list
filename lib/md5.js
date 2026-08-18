const HEX_CHARS = "0123456789abcdef";

function utf8Encode(value) {
  const text = String(value);
  const encoded = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code < 0x80) {
      encoded.push(code);
    } else if (code < 0x800) {
      encoded.push(0xc0 | (code >> 6));
      encoded.push(0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i += 1;
        encoded.push(0xf0 | (code >> 18));
        encoded.push(0x80 | ((code >> 12) & 0x3f));
        encoded.push(0x80 | ((code >> 6) & 0x3f));
        encoded.push(0x80 | (code & 0x3f));
      } else {
        encoded.push(0xef, 0xbf, 0xbd);
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      encoded.push(0xef, 0xbf, 0xbd);
    } else {
      encoded.push(0xe0 | (code >> 12));
      encoded.push(0x80 | ((code >> 6) & 0x3f));
      encoded.push(0x80 | (code & 0x3f));
    }
  }
  return encoded;
}

function safeAdd(x, y) {
  return (x + y) & 0xffffffff;
}

function leftRotate(value, count) {
  return (value << count) | (value >>> (32 - count));
}

function md5cmn(q, a, b, x, s, t) {
  return safeAdd(leftRotate(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
}

function md5ff(a, b, c, d, x, s, t) {
  return md5cmn((b & c) | (~b & d), a, b, x, s, t);
}

function md5gg(a, b, c, d, x, s, t) {
  return md5cmn((b & d) | (c & ~d), a, b, x, s, t);
}

function md5hh(a, b, c, d, x, s, t) {
  return md5cmn(b ^ c ^ d, a, b, x, s, t);
}

function md5ii(a, b, c, d, x, s, t) {
  return md5cmn(c ^ (b | ~d), a, b, x, s, t);
}

function md5Block(state, block) {
  const x = new Array(16);
  for (let i = 0; i < 16; i += 1) {
    const offset = i * 4;
    x[i] = block[offset] | (block[offset + 1] << 8) | (block[offset + 2] << 16) | (block[offset + 3] << 24);
  }

  let a = state[0];
  let b = state[1];
  let c = state[2];
  let d = state[3];

  a = md5ff(a, b, c, d, x[0], 7, -680876936);
  d = md5ff(d, a, b, c, x[1], 12, -389564586);
  c = md5ff(c, d, a, b, x[2], 17, 606105819);
  b = md5ff(b, c, d, a, x[3], 22, -1044525330);
  a = md5ff(a, b, c, d, x[4], 7, -176418897);
  d = md5ff(d, a, b, c, x[5], 12, 1200080426);
  c = md5ff(c, d, a, b, x[6], 17, -1473231341);
  b = md5ff(b, c, d, a, x[7], 22, -45705983);
  a = md5ff(a, b, c, d, x[8], 7, 1770035416);
  d = md5ff(d, a, b, c, x[9], 12, -1958414417);
  c = md5ff(c, d, a, b, x[10], 17, -42063);
  b = md5ff(b, c, d, a, x[11], 22, -1990404162);
  a = md5ff(a, b, c, d, x[12], 7, 1804603682);
  d = md5ff(d, a, b, c, x[13], 12, -40341101);
  c = md5ff(c, d, a, b, x[14], 17, -1502002290);
  b = md5ff(b, c, d, a, x[15], 22, 1236535329);

  a = md5gg(a, b, c, d, x[1], 5, -165796510);
  d = md5gg(d, a, b, c, x[6], 9, -1069501632);
  c = md5gg(c, d, a, b, x[11], 14, 643717713);
  b = md5gg(b, c, d, a, x[0], 20, -373897302);
  a = md5gg(a, b, c, d, x[5], 5, -701558691);
  d = md5gg(d, a, b, c, x[10], 9, 38016083);
  c = md5gg(c, d, a, b, x[15], 14, -660478335);
  b = md5gg(b, c, d, a, x[4], 20, -405537848);
  a = md5gg(a, b, c, d, x[9], 5, 568446438);
  d = md5gg(d, a, b, c, x[14], 9, -1019803690);
  c = md5gg(c, d, a, b, x[3], 14, -187363961);
  b = md5gg(b, c, d, a, x[8], 20, 1163531501);
  a = md5gg(a, b, c, d, x[13], 5, -1444681467);
  d = md5gg(d, a, b, c, x[2], 9, -51403784);
  c = md5gg(c, d, a, b, x[7], 14, 1735328473);
  b = md5gg(b, c, d, a, x[12], 20, -1926607734);

  a = md5hh(a, b, c, d, x[5], 4, -378558);
  d = md5hh(d, a, b, c, x[8], 11, -2022574463);
  c = md5hh(c, d, a, b, x[11], 16, 1839030562);
  b = md5hh(b, c, d, a, x[14], 23, -35309556);
  a = md5hh(a, b, c, d, x[1], 4, -1530992060);
  d = md5hh(d, a, b, c, x[4], 11, 1272893353);
  c = md5hh(c, d, a, b, x[7], 16, -155497632);
  b = md5hh(b, c, d, a, x[10], 23, -1094730640);
  a = md5hh(a, b, c, d, x[13], 4, 681279174);
  d = md5hh(d, a, b, c, x[0], 11, -358537222);
  c = md5hh(c, d, a, b, x[3], 16, -722521979);
  b = md5hh(b, c, d, a, x[6], 23, 76029189);
  a = md5hh(a, b, c, d, x[9], 4, -640364487);
  d = md5hh(d, a, b, c, x[12], 11, -421815835);
  c = md5hh(c, d, a, b, x[15], 16, 530742520);
  b = md5hh(b, c, d, a, x[2], 23, -995338651);

  a = md5ii(a, b, c, d, x[0], 6, -198630844);
  d = md5ii(d, a, b, c, x[7], 10, 1126891415);
  c = md5ii(c, d, a, b, x[14], 15, -1416354905);
  b = md5ii(b, c, d, a, x[5], 21, -57434055);
  a = md5ii(a, b, c, d, x[12], 6, 1700485571);
  d = md5ii(d, a, b, c, x[3], 10, -1894986606);
  c = md5ii(c, d, a, b, x[10], 15, -1051523);
  b = md5ii(b, c, d, a, x[1], 21, -2054922799);
  a = md5ii(a, b, c, d, x[8], 6, 1873313359);
  d = md5ii(d, a, b, c, x[15], 10, -30611744);
  c = md5ii(c, d, a, b, x[6], 15, -1560198380);
  b = md5ii(b, c, d, a, x[13], 21, 1309151649);
  a = md5ii(a, b, c, d, x[4], 6, -145523070);
  d = md5ii(d, a, b, c, x[11], 10, -1120210379);
  c = md5ii(c, d, a, b, x[2], 15, 718787259);
  b = md5ii(b, c, d, a, x[9], 21, -343485551);

  state[0] = safeAdd(a, state[0]);
  state[1] = safeAdd(b, state[1]);
  state[2] = safeAdd(c, state[2]);
  state[3] = safeAdd(d, state[3]);
}

function appendWord(bytes, value) {
  bytes.push(value & 0xff);
  bytes.push((value >>> 8) & 0xff);
  bytes.push((value >>> 16) & 0xff);
  bytes.push((value >>> 24) & 0xff);
}

function wordToHex(word) {
  let hex = "";
  for (let i = 0; i < 4; i += 1) {
    const byte = (word >>> (i * 8)) & 0xff;
    hex += HEX_CHARS[byte >>> 4];
    hex += HEX_CHARS[byte & 0x0f];
  }
  return hex;
}

export function md5Hex(input) {
  const bytes = utf8Encode(input);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  appendWord(bytes, bitLength >>> 0);
  appendWord(bytes, Math.floor(bitLength / 0x100000000) >>> 0);

  const state = [1732584193, -271733879, -1732584194, 271733878];
  for (let i = 0; i < bytes.length; i += 64) {
    md5Block(state, bytes.slice(i, i + 64));
  }

  return wordToHex(state[0]) + wordToHex(state[1]) + wordToHex(state[2]) + wordToHex(state[3]);
}
