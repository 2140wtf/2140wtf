// @ts-nocheck
/**
 * qrcode-generator-js
 * Zero-dependency QR code generator for JavaScript.
 *
 * The core encoding engine (Reed-Solomon error correction, module placement,
 * masking, BCH format/version encoding) is adapted from the original
 * "QR Code Generator for JavaScript" by Kazuhiko Arase, MIT licensed:
 *   Copyright (c) 2009 Kazuhiko Arase
 *   http://www.d-project.com/
 *   Licensed under the MIT license: http://www.opensource.org/licenses/mit-license.php
 *
 * Adapted and wrapped by Andrea Roversi <https://roversia.it/index-en.html>:
 * modern ESM API, automatic version selection, proper UTF-8 byte-mode encoding
 * via TextEncoder (the original truncated multi-byte characters to 8 bits),
 * and matrix/SVG/Canvas output helpers. Legacy GIF/base64 image generation
 * (needed in 2009 for browsers without <canvas> support) has been removed.
 *
 * The word "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
 *
 * @license MIT
 */
// ─── QRMath: Galois field log/exp tables for Reed-Solomon arithmetic ───
const QRMath = (function () {
    const EXP_TABLE = new Array(256);
    const LOG_TABLE = new Array(256);
    for (let i = 0; i < 8; i += 1) {
        EXP_TABLE[i] = 1 << i;
    }
    for (let i = 8; i < 256; i += 1) {
        EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
    }
    for (let i = 0; i < 255; i += 1) {
        LOG_TABLE[EXP_TABLE[i]] = i;
    }
    return {
        glog(n) {
            if (n < 1)
                throw new Error(`glog(${n})`);
            return LOG_TABLE[n];
        },
        gexp(n) {
            while (n < 0)
                n += 255;
            while (n >= 256)
                n -= 255;
            return EXP_TABLE[n];
        },
    };
})();
// ─── qrPolynomial: polynomial arithmetic over GF(256) for Reed-Solomon ───
function qrPolynomial(num, shift) {
    let offset = 0;
    while (offset < num.length && num[offset] === 0)
        offset += 1;
    const _num = new Array(num.length - offset + shift).fill(0);
    for (let i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
    }
    const self = {
        getAt: (index) => _num[index],
        getLength: () => _num.length,
        multiply(e) {
            const result = new Array(self.getLength() + e.getLength() - 1).fill(0);
            for (let i = 0; i < self.getLength(); i += 1) {
                for (let j = 0; j < e.getLength(); j += 1) {
                    result[i + j] ^= QRMath.gexp(QRMath.glog(self.getAt(i)) + QRMath.glog(e.getAt(j)));
                }
            }
            return qrPolynomial(result, 0);
        },
        mod(e) {
            if (self.getLength() - e.getLength() < 0)
                return self;
            const ratio = QRMath.glog(self.getAt(0)) - QRMath.glog(e.getAt(0));
            const result = new Array(self.getLength());
            for (let i = 0; i < self.getLength(); i += 1)
                result[i] = self.getAt(i);
            for (let i = 0; i < e.getLength(); i += 1) {
                result[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
            }
            return qrPolynomial(result, 0).mod(e);
        },
    };
    return self;
}
// ─── QRUtil: BCH encoding, mask patterns, alignment positions, penalty scoring ───
const PATTERN_POSITION_TABLE = [
    [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42],
    [6, 26, 46], [6, 28, 50], [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66],
    [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86],
    [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170],
];
const G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
const G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
const G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);
function getBCHDigit(data) {
    let digit = 0;
    while (data !== 0) {
        digit += 1;
        data >>>= 1;
    }
    return digit;
}
const QRUtil = {
    getBCHTypeInfo(data) {
        let d = data << 10;
        while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
            d ^= G15 << (getBCHDigit(d) - getBCHDigit(G15));
        }
        return ((data << 10) | d) ^ G15_MASK;
    },
    getBCHTypeNumber(data) {
        let d = data << 12;
        while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
            d ^= G18 << (getBCHDigit(d) - getBCHDigit(G18));
        }
        return (data << 12) | d;
    },
    getPatternPosition(typeNumber) {
        return PATTERN_POSITION_TABLE[typeNumber - 1];
    },
    getMaskFunction(maskPattern) {
        switch (maskPattern) {
            case 0: return (i, j) => (i + j) % 2 === 0;
            case 1: return (i, _j) => i % 2 === 0;
            case 2: return (_i, j) => j % 3 === 0;
            case 3: return (i, j) => (i + j) % 3 === 0;
            case 4: return (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0;
            case 5: return (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0;
            case 6: return (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0;
            case 7: return (i, j) => (((i * j) % 3) + ((i + j) % 2)) % 2 === 0;
            default: throw new Error(`bad maskPattern: ${maskPattern}`);
        }
    },
    getErrorCorrectPolynomial(errorCorrectLength) {
        let a = qrPolynomial([1], 0);
        for (let i = 0; i < errorCorrectLength; i += 1) {
            a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
        }
        return a;
    },
    getLostPoint(isDarkFn, moduleCount) {
        let lostPoint = 0;
        for (let row = 0; row < moduleCount; row += 1) {
            for (let col = 0; col < moduleCount; col += 1) {
                let sameCount = 0;
                const dark = isDarkFn(row, col);
                for (let r = -1; r <= 1; r += 1) {
                    if (row + r < 0 || moduleCount <= row + r)
                        continue;
                    for (let c = -1; c <= 1; c += 1) {
                        if (col + c < 0 || moduleCount <= col + c)
                            continue;
                        if (r === 0 && c === 0)
                            continue;
                        if (dark === isDarkFn(row + r, col + c))
                            sameCount += 1;
                    }
                }
                if (sameCount > 5)
                    lostPoint += 3 + sameCount - 5;
            }
        }
        for (let row = 0; row < moduleCount - 1; row += 1) {
            for (let col = 0; col < moduleCount - 1; col += 1) {
                let count = 0;
                if (isDarkFn(row, col))
                    count += 1;
                if (isDarkFn(row + 1, col))
                    count += 1;
                if (isDarkFn(row, col + 1))
                    count += 1;
                if (isDarkFn(row + 1, col + 1))
                    count += 1;
                if (count === 0 || count === 4)
                    lostPoint += 3;
            }
        }
        for (let row = 0; row < moduleCount; row += 1) {
            for (let col = 0; col < moduleCount - 6; col += 1) {
                if (isDarkFn(row, col) && !isDarkFn(row, col + 1) && isDarkFn(row, col + 2) &&
                    isDarkFn(row, col + 3) && isDarkFn(row, col + 4) && !isDarkFn(row, col + 5) &&
                    isDarkFn(row, col + 6)) {
                    lostPoint += 40;
                }
            }
        }
        for (let col = 0; col < moduleCount; col += 1) {
            for (let row = 0; row < moduleCount - 6; row += 1) {
                if (isDarkFn(row, col) && !isDarkFn(row + 1, col) && isDarkFn(row + 2, col) &&
                    isDarkFn(row + 3, col) && isDarkFn(row + 4, col) && !isDarkFn(row + 5, col) &&
                    isDarkFn(row + 6, col)) {
                    lostPoint += 40;
                }
            }
        }
        let darkCount = 0;
        for (let col = 0; col < moduleCount; col += 1) {
            for (let row = 0; row < moduleCount; row += 1) {
                if (isDarkFn(row, col))
                    darkCount += 1;
            }
        }
        const ratio = Math.abs((100 * darkCount) / moduleCount / moduleCount - 50) / 5;
        lostPoint += ratio * 10;
        return lostPoint;
    },
};
const RS_BLOCK_TABLE = [
    [1, 26, 19], [1, 26, 16], [1, 26, 13], [1, 26, 9],
    [1, 44, 34], [1, 44, 28], [1, 44, 22], [1, 44, 16],
    [1, 70, 55], [1, 70, 44], [2, 35, 17], [2, 35, 13],
    [1, 100, 80], [2, 50, 32], [2, 50, 24], [4, 25, 9],
    [1, 134, 108], [2, 67, 43], [2, 33, 15, 2, 34, 16], [2, 33, 11, 2, 34, 12],
    [2, 86, 68], [4, 43, 27], [4, 43, 19], [4, 43, 15],
    [2, 98, 78], [4, 49, 31], [2, 32, 14, 4, 33, 15], [4, 39, 13, 1, 40, 14],
    [2, 121, 97], [2, 60, 38, 2, 61, 39], [4, 40, 18, 2, 41, 19], [4, 40, 14, 2, 41, 15],
    [2, 146, 116], [3, 58, 36, 2, 59, 37], [4, 36, 16, 4, 37, 17], [4, 36, 12, 4, 37, 13],
    [2, 86, 68, 2, 87, 69], [4, 69, 43, 1, 70, 44], [6, 43, 19, 2, 44, 20], [6, 43, 15, 2, 44, 16],
    [4, 101, 81], [1, 80, 50, 4, 81, 51], [4, 50, 22, 4, 51, 23], [3, 36, 12, 8, 37, 13],
    [2, 116, 92, 2, 117, 93], [6, 58, 36, 2, 59, 37], [4, 46, 20, 6, 47, 21], [7, 42, 14, 4, 43, 15],
    [4, 133, 107], [8, 59, 37, 1, 60, 38], [8, 44, 20, 4, 45, 21], [12, 33, 11, 4, 34, 12],
    [3, 145, 115, 1, 146, 116], [4, 64, 40, 5, 65, 41], [11, 36, 16, 5, 37, 17], [11, 36, 12, 5, 37, 13],
    [5, 109, 87, 1, 110, 88], [5, 65, 41, 5, 66, 42], [5, 54, 24, 7, 55, 25], [11, 36, 12, 7, 37, 13],
    [5, 122, 98, 1, 123, 99], [7, 73, 45, 3, 74, 46], [15, 43, 19, 2, 44, 20], [3, 45, 15, 13, 46, 16],
    [1, 135, 107, 5, 136, 108], [10, 74, 46, 1, 75, 47], [1, 50, 22, 15, 51, 23], [2, 42, 14, 17, 43, 15],
    [5, 150, 120, 1, 151, 121], [9, 69, 43, 4, 70, 44], [17, 50, 22, 1, 51, 23], [2, 42, 14, 19, 43, 15],
    [3, 141, 113, 4, 142, 114], [3, 70, 44, 11, 71, 45], [17, 47, 21, 4, 48, 22], [9, 39, 13, 16, 40, 14],
    [3, 135, 107, 5, 136, 108], [3, 67, 41, 13, 68, 42], [15, 54, 24, 5, 55, 25], [15, 43, 15, 10, 44, 16],
    [4, 144, 116, 4, 145, 117], [17, 68, 42], [17, 50, 22, 6, 51, 23], [19, 46, 16, 6, 47, 17],
    [2, 139, 111, 7, 140, 112], [17, 74, 46], [7, 54, 24, 16, 55, 25], [34, 37, 13],
    [4, 151, 121, 5, 152, 122], [4, 75, 47, 14, 76, 48], [11, 54, 24, 14, 55, 25], [16, 45, 15, 14, 46, 16],
    [6, 147, 117, 4, 148, 118], [6, 73, 45, 14, 74, 46], [11, 54, 24, 16, 55, 25], [30, 46, 16, 2, 47, 17],
    [8, 132, 106, 4, 133, 107], [8, 75, 47, 13, 76, 48], [7, 54, 24, 22, 55, 25], [22, 45, 15, 13, 46, 16],
    [10, 142, 114, 2, 143, 115], [19, 74, 46, 4, 75, 47], [28, 50, 22, 6, 51, 23], [33, 46, 16, 4, 47, 17],
    [8, 152, 122, 4, 153, 123], [22, 73, 45, 3, 74, 46], [8, 53, 23, 26, 54, 24], [12, 45, 15, 28, 46, 16],
    [3, 147, 117, 10, 148, 118], [3, 73, 45, 23, 74, 46], [4, 54, 24, 31, 55, 25], [11, 45, 15, 31, 46, 16],
    [7, 146, 116, 7, 147, 117], [21, 73, 45, 7, 74, 46], [1, 53, 23, 37, 54, 24], [19, 45, 15, 26, 46, 16],
    [5, 145, 115, 10, 146, 116], [19, 75, 47, 10, 76, 48], [15, 54, 24, 25, 55, 25], [23, 45, 15, 25, 46, 16],
    [13, 145, 115, 3, 146, 116], [2, 74, 46, 29, 75, 47], [42, 54, 24, 1, 55, 25], [23, 45, 15, 28, 46, 16],
    [17, 145, 115], [10, 74, 46, 23, 75, 47], [10, 54, 24, 35, 55, 25], [19, 45, 15, 35, 46, 16],
    [17, 145, 115, 1, 146, 116], [14, 74, 46, 21, 75, 47], [29, 54, 24, 19, 55, 25], [11, 45, 15, 46, 46, 16],
    [13, 145, 115, 6, 146, 116], [14, 74, 46, 23, 75, 47], [44, 54, 24, 7, 55, 25], [59, 46, 16, 1, 47, 17],
    [12, 151, 121, 7, 152, 122], [12, 75, 47, 26, 76, 48], [39, 54, 24, 14, 55, 25], [22, 45, 15, 41, 46, 16],
    [6, 151, 121, 14, 152, 122], [6, 75, 47, 34, 76, 48], [46, 54, 24, 10, 55, 25], [2, 45, 15, 64, 46, 16],
    [17, 152, 122, 4, 153, 123], [29, 74, 46, 14, 75, 47], [49, 54, 24, 10, 55, 25], [24, 45, 15, 46, 46, 16],
    [4, 152, 122, 18, 153, 123], [13, 74, 46, 32, 75, 47], [48, 54, 24, 14, 55, 25], [42, 45, 15, 32, 46, 16],
    [20, 147, 117, 4, 148, 118], [40, 75, 47, 7, 76, 48], [43, 54, 24, 22, 55, 25], [10, 45, 15, 67, 46, 16],
    [19, 148, 118, 6, 149, 119], [18, 75, 47, 31, 76, 48], [34, 54, 24, 34, 55, 25], [20, 45, 15, 61, 46, 16],
];
const EC_LEVEL_CODE = { L: 1, M: 0, Q: 3, H: 2 };
const EC_LEVEL_ROW_OFFSET = { L: 0, M: 1, Q: 2, H: 3 };
function getRSBlocks(typeNumber, ecLevel) {
    const row = RS_BLOCK_TABLE[(typeNumber - 1) * 4 + EC_LEVEL_ROW_OFFSET[ecLevel]];
    if (!row)
        throw new Error(`No RS block data for version ${typeNumber}, level ${ecLevel}`);
    const blocks = [];
    const groups = row.length / 3;
    for (let i = 0; i < groups; i += 1) {
        const count = row[i * 3];
        const totalCount = row[i * 3 + 1];
        const dataCount = row[i * 3 + 2];
        for (let j = 0; j < count; j += 1) {
            blocks.push({ totalCount, dataCount });
        }
    }
    return blocks;
}
function getTotalDataCodewords(typeNumber, ecLevel) {
    return getRSBlocks(typeNumber, ecLevel).reduce((sum, b) => sum + b.dataCount, 0);
}
function qrBitBuffer() {
    const buffer = [];
    let length = 0;
    return {
        getBuffer: () => buffer,
        getLengthInBits: () => length,
        putBit(bit) {
            const bufIndex = Math.floor(length / 8);
            if (buffer.length <= bufIndex)
                buffer.push(0);
            if (bit)
                buffer[bufIndex] |= 0x80 >>> length % 8;
            length += 1;
        },
        put(num, len) {
            for (let i = 0; i < len; i += 1) {
                this.putBit(((num >>> (len - i - 1)) & 1) === 1);
            }
        },
    };
}
function getLengthIndicatorBits(typeNumber) {
    return typeNumber < 10 ? 8 : 16;
}
const MODE_8BIT_BYTE = 1 << 2;
function selectVersion(byteLength, ecLevel) {
    for (let typeNumber = 1; typeNumber <= 40; typeNumber += 1) {
        const headerBits = 4 + getLengthIndicatorBits(typeNumber);
        const capacityBits = getTotalDataCodewords(typeNumber, ecLevel) * 8;
        if (headerBits + byteLength * 8 <= capacityBits) {
            return typeNumber;
        }
    }
    throw new Error(`Text too long to fit in a QR code at error-correction level ${ecLevel} (max version 40 exceeded)`);
}
function createData(typeNumber, ecLevel, bytes) {
    const buffer = qrBitBuffer();
    buffer.put(MODE_8BIT_BYTE, 4);
    buffer.put(bytes.length, getLengthIndicatorBits(typeNumber));
    for (let i = 0; i < bytes.length; i += 1)
        buffer.put(bytes[i], 8);
    const rsBlocks = getRSBlocks(typeNumber, ecLevel);
    const totalDataCount = rsBlocks.reduce((sum, b) => sum + b.dataCount, 0);
    if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw new Error(`Data overflow: ${buffer.getLengthInBits()} bits > ${totalDataCount * 8} bits capacity`);
    }
    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8)
        buffer.put(0, 4);
    while (buffer.getLengthInBits() % 8 !== 0)
        buffer.putBit(false);
    const PAD0 = 0xec;
    const PAD1 = 0x11;
    while (buffer.getLengthInBits() < totalDataCount * 8) {
        buffer.put(PAD0, 8);
        if (buffer.getLengthInBits() >= totalDataCount * 8)
            break;
        buffer.put(PAD1, 8);
    }
    return interleaveWithECC(buffer, rsBlocks);
}
function interleaveWithECC(buffer, rsBlocks) {
    let offset = 0;
    let maxDcCount = 0;
    let maxEcCount = 0;
    const dcdata = new Array(rsBlocks.length);
    const ecdata = new Array(rsBlocks.length);
    for (let r = 0; r < rsBlocks.length; r += 1) {
        const dcCount = rsBlocks[r].dataCount;
        const ecCount = rsBlocks[r].totalCount - dcCount;
        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);
        dcdata[r] = new Array(dcCount);
        for (let i = 0; i < dcCount; i += 1) {
            dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;
        const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        const rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
        const modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (let i = 0; i < ecdata[r].length; i += 1) {
            const modIndex = i + modPoly.getLength() - ecdata[r].length;
            ecdata[r][i] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
        }
    }
    const totalCodeCount = rsBlocks.reduce((sum, b) => sum + b.totalCount, 0);
    const data = new Array(totalCodeCount);
    let index = 0;
    for (let i = 0; i < maxDcCount; i += 1) {
        for (let r = 0; r < rsBlocks.length; r += 1) {
            if (i < dcdata[r].length)
                data[index++] = dcdata[r][i];
        }
    }
    for (let i = 0; i < maxEcCount; i += 1) {
        for (let r = 0; r < rsBlocks.length; r += 1) {
            if (i < ecdata[r].length)
                data[index++] = ecdata[r][i];
        }
    }
    return data;
}
function buildMatrix(typeNumber, ecLevel, bytes, forcedMask) {
    const moduleCount = typeNumber * 4 + 17;
    let capturedFunctionModule = null;
    function makeImpl(test, maskPattern, captureFunctionModule) {
        const modules = Array.from({ length: moduleCount }, () => new Array(moduleCount).fill(null));
        const functionModule = captureFunctionModule
            ? Array.from({ length: moduleCount }, () => new Array(moduleCount).fill(false))
            : null;
        const mark = (r, c) => {
            if (functionModule)
                functionModule[r][c] = true;
        };
        function setupPositionProbePattern(row, col) {
            for (let r = -1; r <= 7; r += 1) {
                if (row + r <= -1 || moduleCount <= row + r)
                    continue;
                for (let c = -1; c <= 7; c += 1) {
                    if (col + c <= -1 || moduleCount <= col + c)
                        continue;
                    const inRing = (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
                        (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
                        (2 <= r && r <= 4 && 2 <= c && c <= 4);
                    modules[row + r][col + c] = inRing;
                    mark(row + r, col + c);
                }
            }
        }
        setupPositionProbePattern(0, 0);
        setupPositionProbePattern(moduleCount - 7, 0);
        setupPositionProbePattern(0, moduleCount - 7);
        const pos = QRUtil.getPatternPosition(typeNumber);
        for (let i = 0; i < pos.length; i += 1) {
            for (let j = 0; j < pos.length; j += 1) {
                const row = pos[i];
                const col = pos[j];
                if (modules[row][col] !== null)
                    continue;
                for (let r = -2; r <= 2; r += 1) {
                    for (let c = -2; c <= 2; c += 1) {
                        const ring = r === -2 || r === 2 || c === -2 || c === 2 || (r === 0 && c === 0);
                        modules[row + r][col + c] = ring;
                        mark(row + r, col + c);
                    }
                }
            }
        }
        for (let r = 8; r < moduleCount - 8; r += 1) {
            if (modules[r][6] === null) {
                modules[r][6] = r % 2 === 0;
                mark(r, 6);
            }
        }
        for (let c = 8; c < moduleCount - 8; c += 1) {
            if (modules[6][c] === null) {
                modules[6][c] = c % 2 === 0;
                mark(6, c);
            }
        }
        const typeInfoData = (EC_LEVEL_CODE[ecLevel] << 3) | maskPattern;
        const typeInfoBits = QRUtil.getBCHTypeInfo(typeInfoData);
        for (let i = 0; i < 15; i += 1) {
            const mod = !test && ((typeInfoBits >> i) & 1) === 1;
            if (i < 6) {
                modules[i][8] = mod;
                mark(i, 8);
            }
            else if (i < 8) {
                modules[i + 1][8] = mod;
                mark(i + 1, 8);
            }
            else {
                modules[moduleCount - 15 + i][8] = mod;
                mark(moduleCount - 15 + i, 8);
            }
        }
        for (let i = 0; i < 15; i += 1) {
            const mod = !test && ((typeInfoBits >> i) & 1) === 1;
            if (i < 8) {
                modules[8][moduleCount - i - 1] = mod;
                mark(8, moduleCount - i - 1);
            }
            else if (i < 9) {
                modules[8][15 - i - 1 + 1] = mod;
                mark(8, 15 - i - 1 + 1);
            }
            else {
                modules[8][15 - i - 1] = mod;
                mark(8, 15 - i - 1);
            }
        }
        modules[moduleCount - 8][8] = !test;
        mark(moduleCount - 8, 8);
        if (typeNumber >= 7) {
            const versionBits = QRUtil.getBCHTypeNumber(typeNumber);
            for (let i = 0; i < 18; i += 1) {
                const mod = !test && ((versionBits >> i) & 1) === 1;
                const r = Math.floor(i / 3);
                const c = (i % 3) + moduleCount - 8 - 3;
                modules[r][c] = mod;
                mark(r, c);
            }
            for (let i = 0; i < 18; i += 1) {
                const mod = !test && ((versionBits >> i) & 1) === 1;
                const r = (i % 3) + moduleCount - 8 - 3;
                const c = Math.floor(i / 3);
                modules[r][c] = mod;
                mark(r, c);
            }
        }
        if (captureFunctionModule)
            capturedFunctionModule = functionModule;
        const data = createData(typeNumber, ecLevel, bytes);
        const maskFunc = QRUtil.getMaskFunction(maskPattern);
        let inc = -1;
        let row = moduleCount - 1;
        let bitIndex = 7;
        let byteIndex = 0;
        for (let col = moduleCount - 1; col > 0; col -= 2) {
            if (col === 6)
                col -= 1;
            while (true) {
                for (let c = 0; c < 2; c += 1) {
                    if (modules[row][col - c] === null) {
                        let dark = false;
                        if (byteIndex < data.length) {
                            dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
                        }
                        if (maskFunc(row, col - c))
                            dark = !dark;
                        modules[row][col - c] = dark;
                        bitIndex -= 1;
                        if (bitIndex === -1) {
                            byteIndex += 1;
                            bitIndex = 7;
                        }
                    }
                }
                row += inc;
                if (row < 0 || moduleCount <= row) {
                    row -= inc;
                    inc = -inc;
                    break;
                }
            }
        }
        return modules;
    }
    let bestPattern = forcedMask ?? 0;
    if (forcedMask === undefined) {
        let minLostPoint = Infinity;
        for (let i = 0; i < 8; i += 1) {
            const testModules = makeImpl(true, i, false);
            const isDarkFn = (r, c) => !!testModules[r][c];
            const lostPoint = QRUtil.getLostPoint(isDarkFn, moduleCount);
            if (lostPoint < minLostPoint) {
                minLostPoint = lostPoint;
                bestPattern = i;
            }
        }
    }
    const finalModules = makeImpl(false, bestPattern, true);
    return {
        modules: finalModules,
        moduleCount,
        maskPattern: bestPattern,
        functionModule: capturedFunctionModule,
        rsBlocks: getRSBlocks(typeNumber, ecLevel),
    };
}
export function generateQRCode(text, options = {}) {
    const { errorCorrectionLevel = 'M' } = options;
    if (typeof text !== 'string' || text.length === 0) {
        throw new Error('text must be a non-empty string');
    }
    if (!['L', 'M', 'Q', 'H'].includes(errorCorrectionLevel)) {
        throw new Error(`errorCorrectionLevel must be one of L, M, Q, H (got "${errorCorrectionLevel}")`);
    }
    const bytes = Array.from(new TextEncoder().encode(text));
    const typeNumber = selectVersion(bytes.length, errorCorrectionLevel);
    const { modules, moduleCount } = buildMatrix(typeNumber, errorCorrectionLevel, bytes);
    const isDark = (row, col) => {
        if (row < 0 || moduleCount <= row || col < 0 || moduleCount <= col) {
            throw new Error(`Module coordinates out of range: (${row}, ${col})`);
        }
        return !!modules[row][col];
    };
    const toMatrix = () => modules.map((row) => row.map((cell) => !!cell));
    const toSVG = (cellSize = 4, margin = cellSize * 4, colors = {}) => {
        const { dark = '#000000', light = '#ffffff' } = colors;
        const size = moduleCount * cellSize + margin * 2;
        let path = '';
        for (let r = 0; r < moduleCount; r += 1) {
            for (let c = 0; c < moduleCount; c += 1) {
                if (isDark(r, c)) {
                    const x = c * cellSize + margin;
                    const y = r * cellSize + margin;
                    path += `M${x},${y}h${cellSize}v${cellSize}h-${cellSize}z`;
                }
            }
        }
        return (`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" ` +
            `xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" fill="${light}"/>` +
            `<path d="${path}" fill="${dark}"/></svg>`);
    };
    const toDataURL = (cellSize = 4, margin = cellSize * 4, colors = {}) => {
        if (typeof document === 'undefined') {
            throw new Error('toDataURL() requires a browser environment (document.createElement). Use toMatrix() or toSVG() in Node.');
        }
        const { dark = '#000000', light = '#ffffff' } = colors;
        const size = moduleCount * cellSize + margin * 2;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = light;
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = dark;
        for (let r = 0; r < moduleCount; r += 1) {
            for (let c = 0; c < moduleCount; c += 1) {
                if (isDark(r, c)) {
                    ctx.fillRect(c * cellSize + margin, r * cellSize + margin, cellSize, cellSize);
                }
            }
        }
        return canvas.toDataURL('image/png');
    };
    return { moduleCount, isDark, toMatrix, toSVG, toDataURL };
}
