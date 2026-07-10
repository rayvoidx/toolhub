/* ============================================================
   vendor/qrcode.js — QR 코드 인코더 (ISO/IEC 18004, 바이트 모드)
   qr-gen 서비스용 자체 구현 · 의존성 0 · 제3자 코드 미포함 · CDN 미사용.
   (스펙 계약: QR 엔진은 services/qr-gen/vendor/ 에 로컬 번들)

   지원 범위:
   - 버전 1-40 자동 선택, 오류 복원 레벨 L/M/Q/H
   - UTF-8 바이트 모드 (한글·이모지 포함 전체 유니코드)
   - 마스크 0-7 페널티 점수 자동 선택 (규격 4개 평가 규칙)

   API:
     QRCode.generate(text, level[, opts]) -> {
       version, size, mask, ecLevel, byteLength,
       modules   // modules[row][col] = 1(어두움) | 0(밝음)
     }
       - 용량 초과 시 RangeError(code "QR_OVERFLOW") throw — 호출측이 잡아 안내
       - opts.mask (0-7): 테스트용 마스크 강제 지정
     QRCode.capacity(version, level) -> 조합별 최대 바이트
     QRCode.maxBytes(level)          -> 레벨별 상한 (= capacity(40, level))
   ============================================================ */
(function (global) {
  "use strict";

  /* ---------- GF(256) 산술 (원시다항식 0x11D) ---------- */
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1, i;
    for (i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
  }

  /* ---------- Reed-Solomon ---------- */
  var GEN_CACHE = {};
  function genPoly(ec) {
    if (GEN_CACHE[ec]) return GEN_CACHE[ec];
    var poly = [1], i, j;
    for (i = 0; i < ec; i++) {           // (x + α^i) 를 차례로 곱한다
      var next = new Array(poly.length + 1);
      for (j = 0; j < next.length; j++) next[j] = 0;
      for (j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], EXP[i]);
      }
      poly = next;
    }
    GEN_CACHE[ec] = poly;
    return poly;
  }

  function rsRemainder(data, ec) {       // data 뒤에 붙일 EC 코드워드
    var gen = genPoly(ec);
    var buf = data.slice(), i, j;
    for (i = 0; i < ec; i++) buf.push(0);
    for (i = 0; i < data.length; i++) {
      var c = buf[i];
      if (c !== 0) {
        for (j = 1; j < gen.length; j++) buf[i + j] ^= gfMul(c, gen[j]);
      }
    }
    return buf.slice(data.length);
  }

  /* ---------- 블록 테이블 (ISO/IEC 18004 표 9) ----------
     각 항목: [블록당 EC 코드워드, 그룹1 블록수, 그룹1 데이터, (그룹2 블록수, 그룹2 데이터)]
     레벨 순서: L, M, Q, H */
  var LEVELS = { L: 0, M: 1, Q: 2, H: 3 };
  var EC_TABLE = [
    /* v1 */ [[7, 1, 19], [10, 1, 16], [13, 1, 13], [17, 1, 9]],
    /* v2 */ [[10, 1, 34], [16, 1, 28], [22, 1, 22], [28, 1, 16]],
    /* v3 */ [[15, 1, 55], [26, 1, 44], [18, 2, 17], [22, 2, 13]],
    /* v4 */ [[20, 1, 80], [18, 2, 32], [26, 2, 24], [16, 4, 9]],
    /* v5 */ [[26, 1, 108], [24, 2, 43], [18, 2, 15, 2, 16], [22, 2, 11, 2, 12]],
    /* v6 */ [[18, 2, 68], [16, 4, 27], [24, 4, 19], [28, 4, 15]],
    /* v7 */ [[20, 2, 78], [18, 4, 31], [18, 2, 14, 4, 15], [26, 4, 13, 1, 14]],
    /* v8 */ [[24, 2, 97], [22, 2, 38, 2, 39], [22, 4, 18, 2, 19], [26, 4, 14, 2, 15]],
    /* v9 */ [[30, 2, 116], [22, 3, 36, 2, 37], [20, 4, 16, 4, 17], [24, 4, 12, 4, 13]],
    /* v10 */ [[18, 2, 68, 2, 69], [26, 4, 43, 1, 44], [24, 6, 19, 2, 20], [28, 6, 15, 2, 16]],
    /* v11 */ [[20, 4, 81], [30, 1, 50, 4, 51], [28, 4, 22, 4, 23], [24, 3, 12, 8, 13]],
    /* v12 */ [[24, 2, 92, 2, 93], [22, 6, 36, 2, 37], [26, 4, 20, 6, 21], [28, 7, 14, 4, 15]],
    /* v13 */ [[26, 4, 107], [22, 8, 37, 1, 38], [24, 8, 20, 4, 21], [22, 12, 11, 4, 12]],
    /* v14 */ [[30, 3, 115, 1, 116], [24, 4, 40, 5, 41], [20, 11, 16, 5, 17], [24, 11, 12, 5, 13]],
    /* v15 */ [[22, 5, 87, 1, 88], [24, 5, 41, 5, 42], [30, 5, 24, 7, 25], [24, 11, 12, 7, 13]],
    /* v16 */ [[24, 5, 98, 1, 99], [28, 7, 45, 3, 46], [24, 15, 19, 2, 20], [30, 3, 15, 13, 16]],
    /* v17 */ [[28, 1, 107, 5, 108], [28, 10, 46, 1, 47], [28, 1, 22, 15, 23], [28, 2, 14, 17, 15]],
    /* v18 */ [[30, 5, 120, 1, 121], [26, 9, 43, 4, 44], [28, 17, 22, 1, 23], [28, 2, 14, 19, 15]],
    /* v19 */ [[28, 3, 113, 4, 114], [26, 3, 44, 11, 45], [26, 17, 21, 4, 22], [26, 9, 13, 16, 14]],
    /* v20 */ [[28, 3, 107, 5, 108], [26, 3, 41, 13, 42], [30, 15, 24, 5, 25], [28, 15, 15, 10, 16]],
    /* v21 */ [[28, 4, 116, 4, 117], [26, 17, 42], [28, 17, 22, 6, 23], [30, 19, 16, 6, 17]],
    /* v22 */ [[28, 2, 111, 7, 112], [28, 17, 46], [30, 7, 24, 16, 25], [24, 34, 13]],
    /* v23 */ [[30, 4, 121, 5, 122], [28, 4, 47, 14, 48], [30, 11, 24, 14, 25], [30, 16, 15, 14, 16]],
    /* v24 */ [[30, 6, 117, 4, 118], [28, 6, 45, 14, 46], [30, 11, 24, 16, 25], [30, 30, 16, 2, 17]],
    /* v25 */ [[26, 8, 106, 4, 107], [28, 8, 47, 13, 48], [30, 7, 24, 22, 25], [30, 22, 15, 13, 16]],
    /* v26 */ [[28, 10, 114, 2, 115], [28, 19, 46, 4, 47], [28, 28, 22, 6, 23], [30, 33, 16, 4, 17]],
    /* v27 */ [[30, 8, 122, 4, 123], [28, 22, 45, 3, 46], [30, 8, 23, 26, 24], [30, 12, 15, 28, 16]],
    /* v28 */ [[30, 3, 117, 10, 118], [28, 3, 45, 23, 46], [30, 4, 24, 31, 25], [30, 11, 15, 31, 16]],
    /* v29 */ [[30, 7, 116, 7, 117], [28, 21, 45, 7, 46], [30, 1, 23, 37, 24], [30, 19, 15, 26, 16]],
    /* v30 */ [[30, 5, 115, 10, 116], [28, 19, 47, 10, 48], [30, 15, 24, 25, 25], [30, 23, 15, 25, 16]],
    /* v31 */ [[30, 13, 115, 3, 116], [28, 2, 46, 29, 47], [30, 42, 24, 1, 25], [30, 23, 15, 28, 16]],
    /* v32 */ [[30, 17, 115], [28, 10, 46, 23, 47], [30, 10, 24, 35, 25], [30, 19, 15, 35, 16]],
    /* v33 */ [[30, 17, 115, 1, 116], [28, 14, 46, 21, 47], [30, 29, 24, 19, 25], [30, 11, 15, 46, 16]],
    /* v34 */ [[30, 13, 115, 6, 116], [28, 14, 46, 23, 47], [30, 44, 24, 7, 25], [30, 59, 16, 1, 17]],
    /* v35 */ [[30, 12, 121, 7, 122], [28, 12, 47, 26, 48], [30, 39, 24, 14, 25], [30, 22, 15, 41, 16]],
    /* v36 */ [[30, 6, 121, 14, 122], [28, 6, 47, 34, 48], [30, 46, 24, 10, 25], [30, 2, 15, 64, 16]],
    /* v37 */ [[30, 17, 122, 4, 123], [28, 29, 46, 14, 47], [30, 49, 24, 10, 25], [30, 24, 15, 46, 16]],
    /* v38 */ [[30, 4, 122, 18, 123], [28, 13, 46, 32, 47], [30, 48, 24, 14, 25], [30, 42, 15, 32, 16]],
    /* v39 */ [[30, 20, 117, 4, 118], [28, 40, 47, 7, 48], [30, 43, 24, 22, 25], [30, 10, 15, 67, 16]],
    /* v40 */ [[30, 19, 118, 6, 119], [28, 18, 47, 31, 48], [30, 34, 24, 34, 25], [30, 20, 15, 61, 16]]
  ];

  function blockInfo(version, level) {
    var e = EC_TABLE[version - 1][LEVELS[level]];
    var dataLens = [], i;
    for (i = 0; i < e[1]; i++) dataLens.push(e[2]);
    if (e.length > 3) for (i = 0; i < e[3]; i++) dataLens.push(e[4]);
    return { ec: e[0], dataLens: dataLens };
  }

  function dataCodewords(version, level) {
    var b = blockInfo(version, level), sum = 0, i;
    for (i = 0; i < b.dataLens.length; i++) sum += b.dataLens[i];
    return sum;
  }

  function countBits(version) { return version < 10 ? 8 : 16; }   // 바이트 모드 문자수 필드

  function capacity(version, level) {
    return Math.floor((dataCodewords(version, level) * 8 - 4 - countBits(version)) / 8);
  }

  /* ---------- UTF-8 인코딩 (서로게이트 쌍 처리 포함) ---------- */
  function utf8Bytes(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
        var lo = str.charCodeAt(i + 1);
        if (lo >= 0xDC00 && lo <= 0xDFFF) {
          c = ((c - 0xD800) << 10) + (lo - 0xDC00) + 0x10000;
          i++;
        }
      }
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  /* ---------- 비트 버퍼 ---------- */
  function BitBuf() { this.bytes = []; this.length = 0; }
  BitBuf.prototype.putBit = function (bit) {
    var idx = this.length >> 3;
    if (this.bytes.length <= idx) this.bytes.push(0);
    if (bit) this.bytes[idx] |= 0x80 >>> (this.length & 7);
    this.length++;
  };
  BitBuf.prototype.put = function (num, len) {
    for (var i = len - 1; i >= 0; i--) this.putBit((num >>> i) & 1);
  };

  /* ---------- 데이터 코드워드 (모드+길이+본문+종단자+패딩) ---------- */
  function buildCodewords(bytes, version, level) {
    var total = dataCodewords(version, level);
    var buf = new BitBuf(), i;
    buf.put(4, 4);                                  // 바이트 모드 지시자 0100
    buf.put(bytes.length, countBits(version));
    for (i = 0; i < bytes.length; i++) buf.put(bytes[i], 8);
    var rest = total * 8 - buf.length;
    buf.put(0, Math.min(4, rest));                  // 종단자 (공간 부족 시 단축 허용)
    if (buf.length & 7) buf.put(0, 8 - (buf.length & 7));
    var pad = [0xEC, 0x11], p = 0;                  // 규격 패딩 바이트 교대
    while (buf.length < total * 8) { buf.put(pad[p], 8); p ^= 1; }
    return buf.bytes;
  }

  /* ---------- 블록 분할 + RS + 인터리브 ---------- */
  function interleave(codewords, version, level) {
    var info = blockInfo(version, level);
    var blocks = [], ecBlocks = [], offset = 0, i, j, maxLen = 0;
    for (i = 0; i < info.dataLens.length; i++) {
      var d = codewords.slice(offset, offset + info.dataLens[i]);
      offset += info.dataLens[i];
      blocks.push(d);
      ecBlocks.push(rsRemainder(d, info.ec));
      if (d.length > maxLen) maxLen = d.length;
    }
    var out = [];
    for (i = 0; i < maxLen; i++) {
      for (j = 0; j < blocks.length; j++) if (i < blocks[j].length) out.push(blocks[j][i]);
    }
    for (i = 0; i < info.ec; i++) {
      for (j = 0; j < ecBlocks.length; j++) out.push(ecBlocks[j][i]);
    }
    return out;
  }

  /* ---------- 정렬 패턴 중심 좌표 (ISO/IEC 18004 부속서 E) ---------- */
  var ALIGN = [null, [],
    [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62],
    [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
    [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170]
  ];

  /* ---------- BCH (포맷·버전 정보) ---------- */
  var G15 = 0x537, G18 = 0x1F25, G15_MASK = 0x5412;
  function bchLen(x) { var n = 0; while (x) { n++; x >>>= 1; } return n; }
  function bchRemainder(data, g) {
    var glen = bchLen(g), d = data;
    while (bchLen(d) >= glen) d ^= g << (bchLen(d) - glen);
    return d;
  }
  function formatBits(level, mask) {
    var ecBits = [1, 0, 3, 2][LEVELS[level]];       // L=01 M=00 Q=11 H=10
    var data = (ecBits << 3) | mask;
    return (((data << 10) | bchRemainder(data << 10, G15)) ^ G15_MASK) & 0x7FFF;
  }
  function versionBits(version) {
    return ((version << 12) | bchRemainder(version << 12, G18)) & 0x3FFFF;
  }

  /* ---------- 마스크 8종 ---------- */
  function maskFn(p, i, j) {
    switch (p) {
      case 0: return (i + j) % 2 === 0;
      case 1: return i % 2 === 0;
      case 2: return j % 3 === 0;
      case 3: return (i + j) % 3 === 0;
      case 4: return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
      case 5: return (i * j) % 2 + (i * j) % 3 === 0;
      case 6: return ((i * j) % 2 + (i * j) % 3) % 2 === 0;
      default: return ((i * j) % 3 + (i + j) % 2) % 2 === 0;
    }
  }

  /* ---------- 매트릭스 조립 ---------- */
  function probe(m, size, row, col) {               // 파인더 패턴 + 분리자 (8×8)
    for (var r = -1; r <= 7; r++) {
      if (row + r < 0 || row + r >= size) continue;
      for (var c = -1; c <= 7; c++) {
        if (col + c < 0 || col + c >= size) continue;
        var dark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                   (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                   (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        m[row + r][col + c] = dark ? 1 : 0;
      }
    }
  }

  function alignment(m, version) {
    var pos = ALIGN[version];
    for (var i = 0; i < pos.length; i++) {
      for (var j = 0; j < pos.length; j++) {
        if (m[pos[i]][pos[j]] !== null) continue;   // 파인더와 겹치면 생략
        for (var r = -2; r <= 2; r++) {
          for (var c = -2; c <= 2; c++) {
            m[pos[i] + r][pos[j] + c] =
              (r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0)) ? 1 : 0;
          }
        }
      }
    }
  }

  function timing(m, size) {
    for (var i = 8; i < size - 8; i++) {
      if (m[i][6] === null) m[i][6] = (i % 2 === 0) ? 1 : 0;
      if (m[6][i] === null) m[6][i] = (i % 2 === 0) ? 1 : 0;
    }
  }

  function writeFormat(m, size, level, mask) {      // 포맷 정보 2사본
    var bits = formatBits(level, mask);
    for (var i = 0; i < 15; i++) {
      var b = (bits >> i) & 1;
      if (i < 6) m[i][8] = b;
      else if (i < 8) m[i + 1][8] = b;
      else m[size - 15 + i][8] = b;
      if (i < 8) m[8][size - i - 1] = b;
      else if (i < 9) m[8][15 - i] = b;
      else m[8][14 - i] = b;
    }
    m[size - 8][8] = 1;                             // 다크 모듈
  }

  function writeVersion(m, size, version) {         // 버전 정보 (v7+) 2사본
    var bits = versionBits(version);
    for (var i = 0; i < 18; i++) {
      var b = (bits >> i) & 1;
      m[Math.floor(i / 3)][size - 11 + (i % 3)] = b;
      m[size - 11 + (i % 3)][Math.floor(i / 3)] = b;
    }
  }

  function placeData(m, size, data, mask) {         // 지그재그 배치 + 마스킹
    var inc = -1, row = size - 1, bitIdx = 7, byteIdx = 0;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;                         // 세로 타이밍 열 건너뜀
      for (;;) {
        for (var c = 0; c < 2; c++) {
          if (m[row][col - c] === null) {
            var dark = 0;
            if (byteIdx < data.length) dark = (data[byteIdx] >>> bitIdx) & 1;
            if (maskFn(mask, row, col - c)) dark ^= 1;
            m[row][col - c] = dark;
            bitIdx--;
            if (bitIdx === -1) { byteIdx++; bitIdx = 7; }
          }
        }
        row += inc;
        if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
      }
    }
  }

  function makeMatrix(version, level, codewords, mask) {
    var size = version * 4 + 17;
    var m = new Array(size), r, c;
    for (r = 0; r < size; r++) {
      m[r] = new Array(size);
      for (c = 0; c < size; c++) m[r][c] = null;
    }
    probe(m, size, 0, 0);
    probe(m, size, size - 7, 0);
    probe(m, size, 0, size - 7);
    alignment(m, version);
    timing(m, size);
    writeFormat(m, size, level, mask);              // 데이터 배치 전에 기록 (영역 확보)
    if (version >= 7) writeVersion(m, size, version);
    placeData(m, size, codewords, mask);
    return m;
  }

  /* ---------- 마스크 평가 (규격 4개 규칙) ---------- */
  function penalty(m, size) {
    var score = 0, r, c, k;
    for (r = 0; r < size; r++) {                    // 규칙1: 5+ 연속 동일색
      var runH = 1, runV = 1;
      for (c = 1; c < size; c++) {
        if (m[r][c] === m[r][c - 1]) runH++;
        else { if (runH >= 5) score += runH - 2; runH = 1; }
        if (m[c][r] === m[c - 1][r]) runV++;
        else { if (runV >= 5) score += runV - 2; runV = 1; }
      }
      if (runH >= 5) score += runH - 2;
      if (runV >= 5) score += runV - 2;
    }
    for (r = 0; r < size - 1; r++) {                // 규칙2: 2×2 동일 블록
      for (c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }
    var P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];     // 규칙3: 파인더 유사 패턴
    var P2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (r = 0; r < size; r++) {
      for (c = 0; c + 11 <= size; c++) {
        var h1 = true, h2 = true, v1 = true, v2 = true;
        for (k = 0; k < 11; k++) {
          if (m[r][c + k] !== P1[k]) h1 = false;
          if (m[r][c + k] !== P2[k]) h2 = false;
          if (m[c + k][r] !== P1[k]) v1 = false;
          if (m[c + k][r] !== P2[k]) v2 = false;
        }
        score += (h1 ? 40 : 0) + (h2 ? 40 : 0) + (v1 ? 40 : 0) + (v2 ? 40 : 0);
      }
    }
    var dark = 0;                                   // 규칙4: 어두운 모듈 비율
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (m[r][c]) dark++;
    score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return score;
  }

  /* ---------- 공개 API ---------- */
  function chooseVersion(byteLen, level) {
    for (var v = 1; v <= 40; v++) if (capacity(v, level) >= byteLen) return v;
    return 0;
  }

  function normalizeLevel(level) {
    return (level && LEVELS.hasOwnProperty(level)) ? level : "M";
  }

  function generate(text, level, opts) {
    level = normalizeLevel(level);
    opts = opts || {};
    var bytes = utf8Bytes(String(text == null ? "" : text));
    var version = chooseVersion(bytes.length, level);
    if (!version) {
      var err = new RangeError("QR_OVERFLOW: input is " + bytes.length +
        " bytes; level " + level + " holds at most " + capacity(40, level) + " bytes");
      err.code = "QR_OVERFLOW";
      throw err;
    }
    var codewords = interleave(buildCodewords(bytes, version, level), version, level);
    var size = version * 4 + 17;
    var masks = (typeof opts.mask === "number") ? [opts.mask & 7] : [0, 1, 2, 3, 4, 5, 6, 7];
    var best = null, bestScore = Infinity, bestMask = 0;
    for (var i = 0; i < masks.length; i++) {
      var m = makeMatrix(version, level, codewords, masks[i]);
      var s = penalty(m, size);
      if (s < bestScore) { bestScore = s; best = m; bestMask = masks[i]; }
    }
    return {
      version: version,
      size: size,
      mask: bestMask,
      ecLevel: level,
      byteLength: bytes.length,
      modules: best
    };
  }

  var QRCode = {
    generate: generate,
    capacity: capacity,
    maxBytes: function (level) { return capacity(40, normalizeLevel(level)); },
    _internals: {                                    // 단위 테스트 전용 (앱 코드는 사용 금지)
      EC_TABLE: EC_TABLE, ALIGN: ALIGN, LEVELS: LEVELS,
      blockInfo: blockInfo, dataCodewords: dataCodewords, capacity: capacity,
      formatBits: formatBits, versionBits: versionBits,
      rsRemainder: rsRemainder, gfMul: gfMul, genPoly: genPoly,
      utf8Bytes: utf8Bytes, buildCodewords: buildCodewords, interleave: interleave,
      makeMatrix: makeMatrix, maskFn: maskFn, penalty: penalty
    }
  };

  if (typeof module !== "undefined" && module.exports) module.exports = QRCode; // node 단위 테스트용
  if (global) global.QRCode = QRCode;
})(typeof window !== "undefined" ? window : this);
