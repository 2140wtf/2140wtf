import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
//#region \0rolldown/runtime.js
var __defProp$1 = Object.defineProperty;
var __esmMin = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp$1(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp$1(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region node_modules/nostr-tools/node_modules/@noble/hashes/utils.js
/**
* Utilities for hex, bytes, CSPRNG.
* @module
*/
/*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
/** Checks if something is Uint8Array. Be careful: nodejs Buffer will return true. */
function isBytes$4(a) {
	return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
/** Asserts something is positive integer. */
function anumber$4(n, title = "") {
	if (!Number.isSafeInteger(n) || n < 0) {
		const prefix = title && `"${title}" `;
		throw new Error(`${prefix}expected integer >= 0, got ${n}`);
	}
}
/** Asserts something is Uint8Array. */
function abytes$4(value, length, title = "") {
	const bytes = isBytes$4(value);
	const len = value?.length;
	const needsLen = length !== void 0;
	if (!bytes || needsLen && len !== length) {
		const prefix = title && `"${title}" `;
		const ofLen = needsLen ? ` of length ${length}` : "";
		const got = bytes ? `length=${len}` : `type=${typeof value}`;
		throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
	}
	return value;
}
/** Asserts something is hash */
function ahash$1(h) {
	if (typeof h !== "function" || typeof h.create !== "function") throw new Error("Hash must wrapped by utils.createHasher");
	anumber$4(h.outputLen);
	anumber$4(h.blockLen);
}
/** Asserts a hash instance has not been destroyed / finished */
function aexists$2(instance, checkFinished = true) {
	if (instance.destroyed) throw new Error("Hash instance has been destroyed");
	if (checkFinished && instance.finished) throw new Error("Hash#digest() has already been called");
}
/** Asserts output is properly-sized byte array */
function aoutput$2(out, instance) {
	abytes$4(out, void 0, "digestInto() output");
	const min = instance.outputLen;
	if (out.length < min) throw new Error("\"digestInto() output\" expected to be of length >=" + min);
}
/** Zeroize a byte array. Warning: JS provides no guarantees. */
function clean$2(...arrays) {
	for (let i = 0; i < arrays.length; i++) arrays[i].fill(0);
}
/** Create DataView of an array for easy byte-level manipulation. */
function createView$2(arr) {
	return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
/** The rotate right (circular right shift) operation for uint32 */
function rotr$1(word, shift) {
	return word << 32 - shift | word >>> shift;
}
/**
* Convert byte array to hex string. Uses built-in function, when available.
* @example bytesToHex(Uint8Array.from([0xca, 0xfe, 0x01, 0x23])) // 'cafe0123'
*/
function bytesToHex$2(bytes) {
	abytes$4(bytes);
	if (hasHexBuiltin$2) return bytes.toHex();
	let hex = "";
	for (let i = 0; i < bytes.length; i++) hex += hexes$1[bytes[i]];
	return hex;
}
function asciiToBase16$1(ch) {
	if (ch >= asciis$1._0 && ch <= asciis$1._9) return ch - asciis$1._0;
	if (ch >= asciis$1.A && ch <= asciis$1.F) return ch - (asciis$1.A - 10);
	if (ch >= asciis$1.a && ch <= asciis$1.f) return ch - (asciis$1.a - 10);
}
/**
* Convert hex string to byte array. Uses built-in function, when available.
* @example hexToBytes('cafe0123') // Uint8Array.from([0xca, 0xfe, 0x01, 0x23])
*/
function hexToBytes$2(hex) {
	if (typeof hex !== "string") throw new Error("hex string expected, got " + typeof hex);
	if (hasHexBuiltin$2) return Uint8Array.fromHex(hex);
	const hl = hex.length;
	const al = hl / 2;
	if (hl % 2) throw new Error("hex string expected, got unpadded hex of length " + hl);
	const array = new Uint8Array(al);
	for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
		const n1 = asciiToBase16$1(hex.charCodeAt(hi));
		const n2 = asciiToBase16$1(hex.charCodeAt(hi + 1));
		if (n1 === void 0 || n2 === void 0) {
			const char = hex[hi] + hex[hi + 1];
			throw new Error("hex string expected, got non-hex character \"" + char + "\" at index " + hi);
		}
		array[ai] = n1 * 16 + n2;
	}
	return array;
}
/** Copies several Uint8Arrays into one. */
function concatBytes$2(...arrays) {
	let sum = 0;
	for (let i = 0; i < arrays.length; i++) {
		const a = arrays[i];
		abytes$4(a);
		sum += a.length;
	}
	const res = new Uint8Array(sum);
	for (let i = 0, pad = 0; i < arrays.length; i++) {
		const a = arrays[i];
		res.set(a, pad);
		pad += a.length;
	}
	return res;
}
/** Creates function with outputLen, blockLen, create properties from a class constructor. */
function createHasher$1(hashCons, info = {}) {
	const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
	const tmp = hashCons(void 0);
	hashC.outputLen = tmp.outputLen;
	hashC.blockLen = tmp.blockLen;
	hashC.create = (opts) => hashCons(opts);
	Object.assign(hashC, info);
	return Object.freeze(hashC);
}
/** Cryptographically secure PRNG. Uses internal OS-level `crypto.getRandomValues`. */
function randomBytes$2(bytesLength = 32) {
	const cr = typeof globalThis === "object" ? globalThis.crypto : null;
	if (typeof cr?.getRandomValues !== "function") throw new Error("crypto.getRandomValues must be defined");
	return cr.getRandomValues(new Uint8Array(bytesLength));
}
var hasHexBuiltin$2, hexes$1, asciis$1, oidNist$1;
var init_utils$1 = __esmMin((() => {
	hasHexBuiltin$2 = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function")();
	hexes$1 = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
	asciis$1 = {
		_0: 48,
		_9: 57,
		A: 65,
		F: 70,
		a: 97,
		f: 102
	};
	oidNist$1 = (suffix) => ({ oid: Uint8Array.from([
		6,
		9,
		96,
		134,
		72,
		1,
		101,
		3,
		4,
		2,
		suffix
	]) });
}));
//#endregion
//#region node_modules/nostr-tools/node_modules/@noble/hashes/_md.js
/** Choice: a ? b : c */
function Chi$1(a, b, c) {
	return a & b ^ ~a & c;
}
/** Majority function, true if any two inputs is true. */
function Maj$1(a, b, c) {
	return a & b ^ a & c ^ b & c;
}
var HashMD$1, SHA256_IV$1;
var init__md = __esmMin((() => {
	init_utils$1();
	HashMD$1 = class {
		blockLen;
		outputLen;
		padOffset;
		isLE;
		buffer;
		view;
		finished = false;
		length = 0;
		pos = 0;
		destroyed = false;
		constructor(blockLen, outputLen, padOffset, isLE) {
			this.blockLen = blockLen;
			this.outputLen = outputLen;
			this.padOffset = padOffset;
			this.isLE = isLE;
			this.buffer = new Uint8Array(blockLen);
			this.view = createView$2(this.buffer);
		}
		update(data) {
			aexists$2(this);
			abytes$4(data);
			const { view, buffer, blockLen } = this;
			const len = data.length;
			for (let pos = 0; pos < len;) {
				const take = Math.min(blockLen - this.pos, len - pos);
				if (take === blockLen) {
					const dataView = createView$2(data);
					for (; blockLen <= len - pos; pos += blockLen) this.process(dataView, pos);
					continue;
				}
				buffer.set(data.subarray(pos, pos + take), this.pos);
				this.pos += take;
				pos += take;
				if (this.pos === blockLen) {
					this.process(view, 0);
					this.pos = 0;
				}
			}
			this.length += data.length;
			this.roundClean();
			return this;
		}
		digestInto(out) {
			aexists$2(this);
			aoutput$2(out, this);
			this.finished = true;
			const { buffer, view, blockLen, isLE } = this;
			let { pos } = this;
			buffer[pos++] = 128;
			clean$2(this.buffer.subarray(pos));
			if (this.padOffset > blockLen - pos) {
				this.process(view, 0);
				pos = 0;
			}
			for (let i = pos; i < blockLen; i++) buffer[i] = 0;
			view.setBigUint64(blockLen - 8, BigInt(this.length * 8), isLE);
			this.process(view, 0);
			const oview = createView$2(out);
			const len = this.outputLen;
			if (len % 4) throw new Error("_sha2: outputLen must be aligned to 32bit");
			const outLen = len / 4;
			const state = this.get();
			if (outLen > state.length) throw new Error("_sha2: outputLen bigger than state");
			for (let i = 0; i < outLen; i++) oview.setUint32(4 * i, state[i], isLE);
		}
		digest() {
			const { buffer, outputLen } = this;
			this.digestInto(buffer);
			const res = buffer.slice(0, outputLen);
			this.destroy();
			return res;
		}
		_cloneInto(to) {
			to ||= new this.constructor();
			to.set(...this.get());
			const { blockLen, buffer, length, finished, destroyed, pos } = this;
			to.destroyed = destroyed;
			to.finished = finished;
			to.length = length;
			to.pos = pos;
			if (length % blockLen) to.buffer.set(buffer);
			return to;
		}
		clone() {
			return this._cloneInto();
		}
	};
	SHA256_IV$1 = /* @__PURE__ */ Uint32Array.from([
		1779033703,
		3144134277,
		1013904242,
		2773480762,
		1359893119,
		2600822924,
		528734635,
		1541459225
	]);
}));
//#endregion
//#region node_modules/nostr-tools/node_modules/@noble/hashes/sha2.js
var SHA256_K$1, SHA256_W$1, SHA2_32B$1, _SHA256$1, sha256$1;
var init_sha2 = __esmMin((() => {
	init__md();
	init_utils$1();
	SHA256_K$1 = /* @__PURE__ */ Uint32Array.from([
		1116352408,
		1899447441,
		3049323471,
		3921009573,
		961987163,
		1508970993,
		2453635748,
		2870763221,
		3624381080,
		310598401,
		607225278,
		1426881987,
		1925078388,
		2162078206,
		2614888103,
		3248222580,
		3835390401,
		4022224774,
		264347078,
		604807628,
		770255983,
		1249150122,
		1555081692,
		1996064986,
		2554220882,
		2821834349,
		2952996808,
		3210313671,
		3336571891,
		3584528711,
		113926993,
		338241895,
		666307205,
		773529912,
		1294757372,
		1396182291,
		1695183700,
		1986661051,
		2177026350,
		2456956037,
		2730485921,
		2820302411,
		3259730800,
		3345764771,
		3516065817,
		3600352804,
		4094571909,
		275423344,
		430227734,
		506948616,
		659060556,
		883997877,
		958139571,
		1322822218,
		1537002063,
		1747873779,
		1955562222,
		2024104815,
		2227730452,
		2361852424,
		2428436474,
		2756734187,
		3204031479,
		3329325298
	]);
	SHA256_W$1 = /* @__PURE__ */ new Uint32Array(64);
	SHA2_32B$1 = class extends HashMD$1 {
		constructor(outputLen) {
			super(64, outputLen, 8, false);
		}
		get() {
			const { A, B, C, D, E, F, G, H } = this;
			return [
				A,
				B,
				C,
				D,
				E,
				F,
				G,
				H
			];
		}
		set(A, B, C, D, E, F, G, H) {
			this.A = A | 0;
			this.B = B | 0;
			this.C = C | 0;
			this.D = D | 0;
			this.E = E | 0;
			this.F = F | 0;
			this.G = G | 0;
			this.H = H | 0;
		}
		process(view, offset) {
			for (let i = 0; i < 16; i++, offset += 4) SHA256_W$1[i] = view.getUint32(offset, false);
			for (let i = 16; i < 64; i++) {
				const W15 = SHA256_W$1[i - 15];
				const W2 = SHA256_W$1[i - 2];
				const s0 = rotr$1(W15, 7) ^ rotr$1(W15, 18) ^ W15 >>> 3;
				SHA256_W$1[i] = (rotr$1(W2, 17) ^ rotr$1(W2, 19) ^ W2 >>> 10) + SHA256_W$1[i - 7] + s0 + SHA256_W$1[i - 16] | 0;
			}
			let { A, B, C, D, E, F, G, H } = this;
			for (let i = 0; i < 64; i++) {
				const sigma1 = rotr$1(E, 6) ^ rotr$1(E, 11) ^ rotr$1(E, 25);
				const T1 = H + sigma1 + Chi$1(E, F, G) + SHA256_K$1[i] + SHA256_W$1[i] | 0;
				const T2 = (rotr$1(A, 2) ^ rotr$1(A, 13) ^ rotr$1(A, 22)) + Maj$1(A, B, C) | 0;
				H = G;
				G = F;
				F = E;
				E = D + T1 | 0;
				D = C;
				C = B;
				B = A;
				A = T1 + T2 | 0;
			}
			A = A + this.A | 0;
			B = B + this.B | 0;
			C = C + this.C | 0;
			D = D + this.D | 0;
			E = E + this.E | 0;
			F = F + this.F | 0;
			G = G + this.G | 0;
			H = H + this.H | 0;
			this.set(A, B, C, D, E, F, G, H);
		}
		roundClean() {
			clean$2(SHA256_W$1);
		}
		destroy() {
			this.set(0, 0, 0, 0, 0, 0, 0, 0);
			clean$2(this.buffer);
		}
	};
	_SHA256$1 = class extends SHA2_32B$1 {
		A = SHA256_IV$1[0] | 0;
		B = SHA256_IV$1[1] | 0;
		C = SHA256_IV$1[2] | 0;
		D = SHA256_IV$1[3] | 0;
		E = SHA256_IV$1[4] | 0;
		F = SHA256_IV$1[5] | 0;
		G = SHA256_IV$1[6] | 0;
		H = SHA256_IV$1[7] | 0;
		constructor() {
			super(32);
		}
	};
	sha256$1 = /* @__PURE__ */ createHasher$1(() => new _SHA256$1(), /* @__PURE__ */ oidNist$1(1));
}));
//#endregion
//#region node_modules/nostr-tools/node_modules/@noble/curves/utils.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function abool$2(value, title = "") {
	if (typeof value !== "boolean") {
		const prefix = title && `"${title}" `;
		throw new Error(prefix + "expected boolean, got type=" + typeof value);
	}
	return value;
}
function abignumber$1(n) {
	if (typeof n === "bigint") {
		if (!isPosBig$1(n)) throw new Error("positive bigint expected, got " + n);
	} else anumber$4(n);
	return n;
}
function numberToHexUnpadded$1(num) {
	const hex = abignumber$1(num).toString(16);
	return hex.length & 1 ? "0" + hex : hex;
}
function hexToNumber$1(hex) {
	if (typeof hex !== "string") throw new Error("hex string expected, got " + typeof hex);
	return hex === "" ? _0n$9 : BigInt("0x" + hex);
}
function bytesToNumberBE$1(bytes) {
	return hexToNumber$1(bytesToHex$2(bytes));
}
function bytesToNumberLE$1(bytes) {
	return hexToNumber$1(bytesToHex$2(copyBytes$2(abytes$4(bytes)).reverse()));
}
function numberToBytesBE$1(n, len) {
	anumber$4(len);
	n = abignumber$1(n);
	const res = hexToBytes$2(n.toString(16).padStart(len * 2, "0"));
	if (res.length !== len) throw new Error("number too large");
	return res;
}
function numberToBytesLE$1(n, len) {
	return numberToBytesBE$1(n, len).reverse();
}
/**
* Copies Uint8Array. We can't use u8a.slice(), because u8a can be Buffer,
* and Buffer#slice creates mutable copy. Never use Buffers!
*/
function copyBytes$2(bytes) {
	return Uint8Array.from(bytes);
}
/**
* Decodes 7-bit ASCII string to Uint8Array, throws on non-ascii symbols
* Should be safe to use for things expected to be ASCII.
* Returns exact same result as `TextEncoder` for ASCII or throws.
*/
function asciiToBytes$1(ascii) {
	return Uint8Array.from(ascii, (c, i) => {
		const charCode = c.charCodeAt(0);
		if (c.length !== 1 || charCode > 127) throw new Error(`string contains non-ASCII character "${ascii[i]}" with code ${charCode} at position ${i}`);
		return charCode;
	});
}
function inRange$1(n, min, max) {
	return isPosBig$1(n) && isPosBig$1(min) && isPosBig$1(max) && min <= n && n < max;
}
/**
* Asserts min <= n < max. NOTE: It's < max and not <= max.
* @example
* aInRange('x', x, 1n, 256n); // would assume x is in (1n..255n)
*/
function aInRange$1(title, n, min, max) {
	if (!inRange$1(n, min, max)) throw new Error("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
/**
* Calculates amount of bits in a bigint.
* Same as `n.toString(2).length`
* TODO: merge with nLength in modular
*/
function bitLen$1(n) {
	let len;
	for (len = 0; n > _0n$9; n >>= _1n$7, len += 1);
	return len;
}
/**
* Minimal HMAC-DRBG from NIST 800-90 for RFC6979 sigs.
* @returns function that will call DRBG until 2nd arg returns something meaningful
* @example
*   const drbg = createHmacDRBG<Key>(32, 32, hmac);
*   drbg(seed, bytesToKey); // bytesToKey must return Key or undefined
*/
function createHmacDrbg$1(hashLen, qByteLen, hmacFn) {
	anumber$4(hashLen, "hashLen");
	anumber$4(qByteLen, "qByteLen");
	if (typeof hmacFn !== "function") throw new Error("hmacFn must be a function");
	const u8n = (len) => new Uint8Array(len);
	const NULL = Uint8Array.of();
	const byte0 = Uint8Array.of(0);
	const byte1 = Uint8Array.of(1);
	const _maxDrbgIters = 1e3;
	let v = u8n(hashLen);
	let k = u8n(hashLen);
	let i = 0;
	const reset = () => {
		v.fill(1);
		k.fill(0);
		i = 0;
	};
	const h = (...msgs) => hmacFn(k, concatBytes$2(v, ...msgs));
	const reseed = (seed = NULL) => {
		k = h(byte0, seed);
		v = h();
		if (seed.length === 0) return;
		k = h(byte1, seed);
		v = h();
	};
	const gen = () => {
		if (i++ >= _maxDrbgIters) throw new Error("drbg: tried max amount of iterations");
		let len = 0;
		const out = [];
		while (len < qByteLen) {
			v = h();
			const sl = v.slice();
			out.push(sl);
			len += v.length;
		}
		return concatBytes$2(...out);
	};
	const genUntil = (seed, pred) => {
		reset();
		reseed(seed);
		let res = void 0;
		while (!(res = pred(gen()))) reseed();
		reset();
		return res;
	};
	return genUntil;
}
function validateObject$1(object, fields = {}, optFields = {}) {
	if (!object || typeof object !== "object") throw new Error("expected valid options object");
	function checkField(fieldName, expectedType, isOpt) {
		const val = object[fieldName];
		if (isOpt && val === void 0) return;
		const current = typeof val;
		if (current !== expectedType || val === null) throw new Error(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
	}
	const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
	iter(fields, false);
	iter(optFields, true);
}
/**
* Memoizes (caches) computation result.
* Uses WeakMap: the value is going auto-cleaned by GC after last reference is removed.
*/
function memoized(fn) {
	const map = /* @__PURE__ */ new WeakMap();
	return (arg, ...args) => {
		const val = map.get(arg);
		if (val !== void 0) return val;
		const computed = fn(arg, ...args);
		map.set(arg, computed);
		return computed;
	};
}
var _0n$9, _1n$7, isPosBig$1, bitMask$1;
var init_utils = __esmMin((() => {
	init_utils$1();
	_0n$9 = /* @__PURE__ */ BigInt(0);
	_1n$7 = /* @__PURE__ */ BigInt(1);
	isPosBig$1 = (n) => typeof n === "bigint" && _0n$9 <= n;
	bitMask$1 = (n) => (_1n$7 << BigInt(n)) - _1n$7;
}));
//#endregion
//#region node_modules/nostr-tools/node_modules/@noble/curves/abstract/modular.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function mod$1(a, b) {
	const result = a % b;
	return result >= _0n$8 ? result : b + result;
}
/** Does `x^(2^power)` mod p. `pow2(30, 4)` == `30^(2^4)` */
function pow2$1(x, power, modulo) {
	let res = x;
	while (power-- > _0n$8) {
		res *= res;
		res %= modulo;
	}
	return res;
}
/**
* Inverses number over modulo.
* Implemented using [Euclidean GCD](https://brilliant.org/wiki/extended-euclidean-algorithm/).
*/
function invert$1(number, modulo) {
	if (number === _0n$8) throw new Error("invert: expected non-zero number");
	if (modulo <= _0n$8) throw new Error("invert: expected positive modulus, got " + modulo);
	let a = mod$1(number, modulo);
	let b = modulo;
	let x = _0n$8, y = _1n$6, u = _1n$6, v = _0n$8;
	while (a !== _0n$8) {
		const q = b / a;
		const r = b % a;
		const m = x - u * q;
		const n = y - v * q;
		b = a, a = r, x = u, y = v, u = m, v = n;
	}
	if (b !== _1n$6) throw new Error("invert: does not exist");
	return mod$1(x, modulo);
}
function assertIsSquare$1(Fp, root, n) {
	if (!Fp.eql(Fp.sqr(root), n)) throw new Error("Cannot find square root");
}
function sqrt3mod4$1(Fp, n) {
	const p1div4 = (Fp.ORDER + _1n$6) / _4n$3;
	const root = Fp.pow(n, p1div4);
	assertIsSquare$1(Fp, root, n);
	return root;
}
function sqrt5mod8$1(Fp, n) {
	const p5div8 = (Fp.ORDER - _5n$1) / _8n$1;
	const n2 = Fp.mul(n, _2n$5);
	const v = Fp.pow(n2, p5div8);
	const nv = Fp.mul(n, v);
	const i = Fp.mul(Fp.mul(nv, _2n$5), v);
	const root = Fp.mul(nv, Fp.sub(i, Fp.ONE));
	assertIsSquare$1(Fp, root, n);
	return root;
}
function sqrt9mod16$1(P) {
	const Fp_ = Field$1(P);
	const tn = tonelliShanks$1(P);
	const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
	const c2 = tn(Fp_, c1);
	const c3 = tn(Fp_, Fp_.neg(c1));
	const c4 = (P + _7n$1) / _16n$1;
	return (Fp, n) => {
		let tv1 = Fp.pow(n, c4);
		let tv2 = Fp.mul(tv1, c1);
		const tv3 = Fp.mul(tv1, c2);
		const tv4 = Fp.mul(tv1, c3);
		const e1 = Fp.eql(Fp.sqr(tv2), n);
		const e2 = Fp.eql(Fp.sqr(tv3), n);
		tv1 = Fp.cmov(tv1, tv2, e1);
		tv2 = Fp.cmov(tv4, tv3, e2);
		const e3 = Fp.eql(Fp.sqr(tv2), n);
		const root = Fp.cmov(tv1, tv2, e3);
		assertIsSquare$1(Fp, root, n);
		return root;
	};
}
/**
* Tonelli-Shanks square root search algorithm.
* 1. https://eprint.iacr.org/2012/685.pdf (page 12)
* 2. Square Roots from 1; 24, 51, 10 to Dan Shanks
* @param P field order
* @returns function that takes field Fp (created from P) and number n
*/
function tonelliShanks$1(P) {
	if (P < _3n$3) throw new Error("sqrt is not defined for small field");
	let Q = P - _1n$6;
	let S = 0;
	while (Q % _2n$5 === _0n$8) {
		Q /= _2n$5;
		S++;
	}
	let Z = _2n$5;
	const _Fp = Field$1(P);
	while (FpLegendre$1(_Fp, Z) === 1) if (Z++ > 1e3) throw new Error("Cannot find square root: probably non-prime P");
	if (S === 1) return sqrt3mod4$1;
	let cc = _Fp.pow(Z, Q);
	const Q1div2 = (Q + _1n$6) / _2n$5;
	return function tonelliSlow(Fp, n) {
		if (Fp.is0(n)) return n;
		if (FpLegendre$1(Fp, n) !== 1) throw new Error("Cannot find square root");
		let M = S;
		let c = Fp.mul(Fp.ONE, cc);
		let t = Fp.pow(n, Q);
		let R = Fp.pow(n, Q1div2);
		while (!Fp.eql(t, Fp.ONE)) {
			if (Fp.is0(t)) return Fp.ZERO;
			let i = 1;
			let t_tmp = Fp.sqr(t);
			while (!Fp.eql(t_tmp, Fp.ONE)) {
				i++;
				t_tmp = Fp.sqr(t_tmp);
				if (i === M) throw new Error("Cannot find square root");
			}
			const exponent = _1n$6 << BigInt(M - i - 1);
			const b = Fp.pow(c, exponent);
			M = i;
			c = Fp.sqr(b);
			t = Fp.mul(t, c);
			R = Fp.mul(R, b);
		}
		return R;
	};
}
/**
* Square root for a finite field. Will try optimized versions first:
*
* 1. P ≡ 3 (mod 4)
* 2. P ≡ 5 (mod 8)
* 3. P ≡ 9 (mod 16)
* 4. Tonelli-Shanks algorithm
*
* Different algorithms can give different roots, it is up to user to decide which one they want.
* For example there is FpSqrtOdd/FpSqrtEven to choice root based on oddness (used for hash-to-curve).
*/
function FpSqrt$1(P) {
	if (P % _4n$3 === _3n$3) return sqrt3mod4$1;
	if (P % _8n$1 === _5n$1) return sqrt5mod8$1;
	if (P % _16n$1 === _9n$1) return sqrt9mod16$1(P);
	return tonelliShanks$1(P);
}
function validateField$1(field) {
	validateObject$1(field, FIELD_FIELDS$1.reduce((map, val) => {
		map[val] = "function";
		return map;
	}, {
		ORDER: "bigint",
		BYTES: "number",
		BITS: "number"
	}));
	return field;
}
/**
* Same as `pow` but for Fp: non-constant-time.
* Unsafe in some contexts: uses ladder, so can expose bigint bits.
*/
function FpPow$1(Fp, num, power) {
	if (power < _0n$8) throw new Error("invalid exponent, negatives unsupported");
	if (power === _0n$8) return Fp.ONE;
	if (power === _1n$6) return num;
	let p = Fp.ONE;
	let d = num;
	while (power > _0n$8) {
		if (power & _1n$6) p = Fp.mul(p, d);
		d = Fp.sqr(d);
		power >>= _1n$6;
	}
	return p;
}
/**
* Efficiently invert an array of Field elements.
* Exception-free. Will return `undefined` for 0 elements.
* @param passZero map 0 to 0 (instead of undefined)
*/
function FpInvertBatch$1(Fp, nums, passZero = false) {
	const inverted = new Array(nums.length).fill(passZero ? Fp.ZERO : void 0);
	const multipliedAcc = nums.reduce((acc, num, i) => {
		if (Fp.is0(num)) return acc;
		inverted[i] = acc;
		return Fp.mul(acc, num);
	}, Fp.ONE);
	const invertedAcc = Fp.inv(multipliedAcc);
	nums.reduceRight((acc, num, i) => {
		if (Fp.is0(num)) return acc;
		inverted[i] = Fp.mul(acc, inverted[i]);
		return Fp.mul(acc, num);
	}, invertedAcc);
	return inverted;
}
/**
* Legendre symbol.
* Legendre constant is used to calculate Legendre symbol (a | p)
* which denotes the value of a^((p-1)/2) (mod p).
*
* * (a | p) ≡ 1    if a is a square (mod p), quadratic residue
* * (a | p) ≡ -1   if a is not a square (mod p), quadratic non residue
* * (a | p) ≡ 0    if a ≡ 0 (mod p)
*/
function FpLegendre$1(Fp, n) {
	const p1mod2 = (Fp.ORDER - _1n$6) / _2n$5;
	const powered = Fp.pow(n, p1mod2);
	const yes = Fp.eql(powered, Fp.ONE);
	const zero = Fp.eql(powered, Fp.ZERO);
	const no = Fp.eql(powered, Fp.neg(Fp.ONE));
	if (!yes && !zero && !no) throw new Error("invalid Legendre symbol result");
	return yes ? 1 : zero ? 0 : -1;
}
function nLength$1(n, nBitLength) {
	if (nBitLength !== void 0) anumber$4(nBitLength);
	const _nBitLength = nBitLength !== void 0 ? nBitLength : n.toString(2).length;
	return {
		nBitLength: _nBitLength,
		nByteLength: Math.ceil(_nBitLength / 8)
	};
}
/**
* Creates a finite field. Major performance optimizations:
* * 1. Denormalized operations like mulN instead of mul.
* * 2. Identical object shape: never add or remove keys.
* * 3. `Object.freeze`.
* Fragile: always run a benchmark on a change.
* Security note: operations don't check 'isValid' for all elements for performance reasons,
* it is caller responsibility to check this.
* This is low-level code, please make sure you know what you're doing.
*
* Note about field properties:
* * CHARACTERISTIC p = prime number, number of elements in main subgroup.
* * ORDER q = similar to cofactor in curves, may be composite `q = p^m`.
*
* @param ORDER field order, probably prime, or could be composite
* @param bitLen how many bits the field consumes
* @param isLE (default: false) if encoding / decoding should be in little-endian
* @param redef optional faster redefinitions of sqrt and other methods
*/
function Field$1(ORDER, opts = {}) {
	return new _Field$1(ORDER, opts);
}
/**
* Returns total number of bytes consumed by the field element.
* For example, 32 bytes for usual 256-bit weierstrass curve.
* @param fieldOrder number of field elements, usually CURVE.n
* @returns byte length of field
*/
function getFieldBytesLength$1(fieldOrder) {
	if (typeof fieldOrder !== "bigint") throw new Error("field order must be bigint");
	const bitLength = fieldOrder.toString(2).length;
	return Math.ceil(bitLength / 8);
}
/**
* Returns minimal amount of bytes that can be safely reduced
* by field order.
* Should be 2^-128 for 128-bit curve such as P256.
* @param fieldOrder number of field elements, usually CURVE.n
* @returns byte length of target hash
*/
function getMinHashLength$1(fieldOrder) {
	const length = getFieldBytesLength$1(fieldOrder);
	return length + Math.ceil(length / 2);
}
/**
* "Constant-time" private key generation utility.
* Can take (n + n/2) or more bytes of uniform input e.g. from CSPRNG or KDF
* and convert them into private scalar, with the modulo bias being negligible.
* Needs at least 48 bytes of input for 32-byte private key.
* https://research.kudelskisecurity.com/2020/07/28/the-definitive-guide-to-modulo-bias-and-how-to-avoid-it/
* FIPS 186-5, A.2 https://csrc.nist.gov/publications/detail/fips/186/5/final
* RFC 9380, https://www.rfc-editor.org/rfc/rfc9380#section-5
* @param hash hash output from SHA3 or a similar function
* @param groupOrder size of subgroup - (e.g. secp256k1.Point.Fn.ORDER)
* @param isLE interpret hash bytes as LE num
* @returns valid private scalar
*/
function mapHashToField$1(key, fieldOrder, isLE = false) {
	abytes$4(key);
	const len = key.length;
	const fieldLen = getFieldBytesLength$1(fieldOrder);
	const minLen = getMinHashLength$1(fieldOrder);
	if (len < 16 || len < minLen || len > 1024) throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
	const reduced = mod$1(isLE ? bytesToNumberLE$1(key) : bytesToNumberBE$1(key), fieldOrder - _1n$6) + _1n$6;
	return isLE ? numberToBytesLE$1(reduced, fieldLen) : numberToBytesBE$1(reduced, fieldLen);
}
var _0n$8, _1n$6, _2n$5, _3n$3, _4n$3, _5n$1, _7n$1, _8n$1, _9n$1, _16n$1, FIELD_FIELDS$1, _Field$1;
var init_modular = __esmMin((() => {
	init_utils();
	_0n$8 = /* @__PURE__ */ BigInt(0), _1n$6 = /* @__PURE__ */ BigInt(1), _2n$5 = /* @__PURE__ */ BigInt(2);
	_3n$3 = /* @__PURE__ */ BigInt(3), _4n$3 = /* @__PURE__ */ BigInt(4), _5n$1 = /* @__PURE__ */ BigInt(5);
	_7n$1 = /* @__PURE__ */ BigInt(7), _8n$1 = /* @__PURE__ */ BigInt(8), _9n$1 = /* @__PURE__ */ BigInt(9);
	_16n$1 = /* @__PURE__ */ BigInt(16);
	FIELD_FIELDS$1 = [
		"create",
		"isValid",
		"is0",
		"neg",
		"inv",
		"sqrt",
		"sqr",
		"eql",
		"add",
		"sub",
		"mul",
		"pow",
		"div",
		"addN",
		"subN",
		"mulN",
		"sqrN"
	];
	_Field$1 = class {
		ORDER;
		BITS;
		BYTES;
		isLE;
		ZERO = _0n$8;
		ONE = _1n$6;
		_lengths;
		_sqrt;
		_mod;
		constructor(ORDER, opts = {}) {
			if (ORDER <= _0n$8) throw new Error("invalid field: expected ORDER > 0, got " + ORDER);
			let _nbitLength = void 0;
			this.isLE = false;
			if (opts != null && typeof opts === "object") {
				if (typeof opts.BITS === "number") _nbitLength = opts.BITS;
				if (typeof opts.sqrt === "function") this.sqrt = opts.sqrt;
				if (typeof opts.isLE === "boolean") this.isLE = opts.isLE;
				if (opts.allowedLengths) this._lengths = opts.allowedLengths?.slice();
				if (typeof opts.modFromBytes === "boolean") this._mod = opts.modFromBytes;
			}
			const { nBitLength, nByteLength } = nLength$1(ORDER, _nbitLength);
			if (nByteLength > 2048) throw new Error("invalid field: expected ORDER of <= 2048 bytes");
			this.ORDER = ORDER;
			this.BITS = nBitLength;
			this.BYTES = nByteLength;
			this._sqrt = void 0;
			Object.preventExtensions(this);
		}
		create(num) {
			return mod$1(num, this.ORDER);
		}
		isValid(num) {
			if (typeof num !== "bigint") throw new Error("invalid field element: expected bigint, got " + typeof num);
			return _0n$8 <= num && num < this.ORDER;
		}
		is0(num) {
			return num === _0n$8;
		}
		isValidNot0(num) {
			return !this.is0(num) && this.isValid(num);
		}
		isOdd(num) {
			return (num & _1n$6) === _1n$6;
		}
		neg(num) {
			return mod$1(-num, this.ORDER);
		}
		eql(lhs, rhs) {
			return lhs === rhs;
		}
		sqr(num) {
			return mod$1(num * num, this.ORDER);
		}
		add(lhs, rhs) {
			return mod$1(lhs + rhs, this.ORDER);
		}
		sub(lhs, rhs) {
			return mod$1(lhs - rhs, this.ORDER);
		}
		mul(lhs, rhs) {
			return mod$1(lhs * rhs, this.ORDER);
		}
		pow(num, power) {
			return FpPow$1(this, num, power);
		}
		div(lhs, rhs) {
			return mod$1(lhs * invert$1(rhs, this.ORDER), this.ORDER);
		}
		sqrN(num) {
			return num * num;
		}
		addN(lhs, rhs) {
			return lhs + rhs;
		}
		subN(lhs, rhs) {
			return lhs - rhs;
		}
		mulN(lhs, rhs) {
			return lhs * rhs;
		}
		inv(num) {
			return invert$1(num, this.ORDER);
		}
		sqrt(num) {
			if (!this._sqrt) this._sqrt = FpSqrt$1(this.ORDER);
			return this._sqrt(this, num);
		}
		toBytes(num) {
			return this.isLE ? numberToBytesLE$1(num, this.BYTES) : numberToBytesBE$1(num, this.BYTES);
		}
		fromBytes(bytes, skipValidation = false) {
			abytes$4(bytes);
			const { _lengths: allowedLengths, BYTES, isLE, ORDER, _mod: modFromBytes } = this;
			if (allowedLengths) {
				if (!allowedLengths.includes(bytes.length) || bytes.length > BYTES) throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
				const padded = new Uint8Array(BYTES);
				padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
				bytes = padded;
			}
			if (bytes.length !== BYTES) throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
			let scalar = isLE ? bytesToNumberLE$1(bytes) : bytesToNumberBE$1(bytes);
			if (modFromBytes) scalar = mod$1(scalar, ORDER);
			if (!skipValidation) {
				if (!this.isValid(scalar)) throw new Error("invalid field element: outside of range 0..ORDER");
			}
			return scalar;
		}
		invertBatch(lst) {
			return FpInvertBatch$1(this, lst);
		}
		cmov(a, b, condition) {
			return condition ? b : a;
		}
	};
}));
//#endregion
//#region node_modules/nostr-tools/node_modules/@noble/curves/abstract/curve.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function negateCt$1(condition, item) {
	const neg = item.negate();
	return condition ? neg : item;
}
/**
* Takes a bunch of Projective Points but executes only one
* inversion on all of them. Inversion is very slow operation,
* so this improves performance massively.
* Optimization: converts a list of projective points to a list of identical points with Z=1.
*/
function normalizeZ$1(c, points) {
	const invertedZs = FpInvertBatch$1(c.Fp, points.map((p) => p.Z));
	return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW$1(W, bits) {
	if (!Number.isSafeInteger(W) || W <= 0 || W > bits) throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
}
function calcWOpts$1(W, scalarBits) {
	validateW$1(W, scalarBits);
	const windows = Math.ceil(scalarBits / W) + 1;
	const windowSize = 2 ** (W - 1);
	const maxNumber = 2 ** W;
	return {
		windows,
		windowSize,
		mask: bitMask$1(W),
		maxNumber,
		shiftBy: BigInt(W)
	};
}
function calcOffsets$1(n, window, wOpts) {
	const { windowSize, mask, maxNumber, shiftBy } = wOpts;
	let wbits = Number(n & mask);
	let nextN = n >> shiftBy;
	if (wbits > windowSize) {
		wbits -= maxNumber;
		nextN += _1n$5;
	}
	const offsetStart = window * windowSize;
	const offset = offsetStart + Math.abs(wbits) - 1;
	const isZero = wbits === 0;
	const isNeg = wbits < 0;
	const isNegF = window % 2 !== 0;
	return {
		nextN,
		offset,
		isZero,
		isNeg,
		isNegF,
		offsetF: offsetStart
	};
}
function getW$1(P) {
	return pointWindowSizes$1.get(P) || 1;
}
function assert0$1(n) {
	if (n !== _0n$7) throw new Error("invalid wNAF");
}
/**
* Endomorphism-specific multiplication for Koblitz curves.
* Cost: 128 dbl, 0-256 adds.
*/
function mulEndoUnsafe$1(Point, point, k1, k2) {
	let acc = point;
	let p1 = Point.ZERO;
	let p2 = Point.ZERO;
	while (k1 > _0n$7 || k2 > _0n$7) {
		if (k1 & _1n$5) p1 = p1.add(acc);
		if (k2 & _1n$5) p2 = p2.add(acc);
		acc = acc.double();
		k1 >>= _1n$5;
		k2 >>= _1n$5;
	}
	return {
		p1,
		p2
	};
}
function createField$1(order, field, isLE) {
	if (field) {
		if (field.ORDER !== order) throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
		validateField$1(field);
		return field;
	} else return Field$1(order, { isLE });
}
/** Validates CURVE opts and creates fields */
function createCurveFields$1(type, CURVE, curveOpts = {}, FpFnLE) {
	if (FpFnLE === void 0) FpFnLE = type === "edwards";
	if (!CURVE || typeof CURVE !== "object") throw new Error(`expected valid ${type} CURVE object`);
	for (const p of [
		"p",
		"n",
		"h"
	]) {
		const val = CURVE[p];
		if (!(typeof val === "bigint" && val > _0n$7)) throw new Error(`CURVE.${p} must be positive bigint`);
	}
	const Fp = createField$1(CURVE.p, curveOpts.Fp, FpFnLE);
	const Fn = createField$1(CURVE.n, curveOpts.Fn, FpFnLE);
	const params = [
		"Gx",
		"Gy",
		"a",
		type === "weierstrass" ? "b" : "d"
	];
	for (const p of params) if (!Fp.isValid(CURVE[p])) throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
	CURVE = Object.freeze(Object.assign({}, CURVE));
	return {
		CURVE,
		Fp,
		Fn
	};
}
function createKeygen$1(randomSecretKey, getPublicKey) {
	return function keygen(seed) {
		const secretKey = randomSecretKey(seed);
		return {
			secretKey,
			publicKey: getPublicKey(secretKey)
		};
	};
}
var _0n$7, _1n$5, pointPrecomputes$1, pointWindowSizes$1, wNAF$1;
var init_curve = __esmMin((() => {
	init_utils();
	init_modular();
	_0n$7 = /* @__PURE__ */ BigInt(0);
	_1n$5 = /* @__PURE__ */ BigInt(1);
	pointPrecomputes$1 = /* @__PURE__ */ new WeakMap();
	pointWindowSizes$1 = /* @__PURE__ */ new WeakMap();
	wNAF$1 = class {
		BASE;
		ZERO;
		Fn;
		bits;
		constructor(Point, bits) {
			this.BASE = Point.BASE;
			this.ZERO = Point.ZERO;
			this.Fn = Point.Fn;
			this.bits = bits;
		}
		_unsafeLadder(elm, n, p = this.ZERO) {
			let d = elm;
			while (n > _0n$7) {
				if (n & _1n$5) p = p.add(d);
				d = d.double();
				n >>= _1n$5;
			}
			return p;
		}
		/**
		* Creates a wNAF precomputation window. Used for caching.
		* Default window size is set by `utils.precompute()` and is equal to 8.
		* Number of precomputed points depends on the curve size:
		* 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
		* - 𝑊 is the window size
		* - 𝑛 is the bitlength of the curve order.
		* For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
		* @param point Point instance
		* @param W window size
		* @returns precomputed point tables flattened to a single array
		*/
		precomputeWindow(point, W) {
			const { windows, windowSize } = calcWOpts$1(W, this.bits);
			const points = [];
			let p = point;
			let base = p;
			for (let window = 0; window < windows; window++) {
				base = p;
				points.push(base);
				for (let i = 1; i < windowSize; i++) {
					base = base.add(p);
					points.push(base);
				}
				p = base.double();
			}
			return points;
		}
		/**
		* Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
		* More compact implementation:
		* https://github.com/paulmillr/noble-secp256k1/blob/47cb1669b6e506ad66b35fe7d76132ae97465da2/index.ts#L502-L541
		* @returns real and fake (for const-time) points
		*/
		wNAF(W, precomputes, n) {
			if (!this.Fn.isValid(n)) throw new Error("invalid scalar");
			let p = this.ZERO;
			let f = this.BASE;
			const wo = calcWOpts$1(W, this.bits);
			for (let window = 0; window < wo.windows; window++) {
				const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets$1(n, window, wo);
				n = nextN;
				if (isZero) f = f.add(negateCt$1(isNegF, precomputes[offsetF]));
				else p = p.add(negateCt$1(isNeg, precomputes[offset]));
			}
			assert0$1(n);
			return {
				p,
				f
			};
		}
		/**
		* Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
		* @param acc accumulator point to add result of multiplication
		* @returns point
		*/
		wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
			const wo = calcWOpts$1(W, this.bits);
			for (let window = 0; window < wo.windows; window++) {
				if (n === _0n$7) break;
				const { nextN, offset, isZero, isNeg } = calcOffsets$1(n, window, wo);
				n = nextN;
				if (isZero) continue;
				else {
					const item = precomputes[offset];
					acc = acc.add(isNeg ? item.negate() : item);
				}
			}
			assert0$1(n);
			return acc;
		}
		getPrecomputes(W, point, transform) {
			let comp = pointPrecomputes$1.get(point);
			if (!comp) {
				comp = this.precomputeWindow(point, W);
				if (W !== 1) {
					if (typeof transform === "function") comp = transform(comp);
					pointPrecomputes$1.set(point, comp);
				}
			}
			return comp;
		}
		cached(point, scalar, transform) {
			const W = getW$1(point);
			return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
		}
		unsafe(point, scalar, transform, prev) {
			const W = getW$1(point);
			if (W === 1) return this._unsafeLadder(point, scalar, prev);
			return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
		}
		createCache(P, W) {
			validateW$1(W, this.bits);
			pointWindowSizes$1.set(P, W);
			pointPrecomputes$1.delete(P);
		}
		hasCache(elm) {
			return getW$1(elm) !== 1;
		}
	};
}));
//#endregion
//#region node_modules/nostr-tools/node_modules/@noble/hashes/hmac.js
var _HMAC$1, hmac$1;
var init_hmac = __esmMin((() => {
	init_utils$1();
	_HMAC$1 = class {
		oHash;
		iHash;
		blockLen;
		outputLen;
		finished = false;
		destroyed = false;
		constructor(hash, key) {
			ahash$1(hash);
			abytes$4(key, void 0, "key");
			this.iHash = hash.create();
			if (typeof this.iHash.update !== "function") throw new Error("Expected instance of class which extends utils.Hash");
			this.blockLen = this.iHash.blockLen;
			this.outputLen = this.iHash.outputLen;
			const blockLen = this.blockLen;
			const pad = new Uint8Array(blockLen);
			pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
			for (let i = 0; i < pad.length; i++) pad[i] ^= 54;
			this.iHash.update(pad);
			this.oHash = hash.create();
			for (let i = 0; i < pad.length; i++) pad[i] ^= 106;
			this.oHash.update(pad);
			clean$2(pad);
		}
		update(buf) {
			aexists$2(this);
			this.iHash.update(buf);
			return this;
		}
		digestInto(out) {
			aexists$2(this);
			abytes$4(out, this.outputLen, "output");
			this.finished = true;
			this.iHash.digestInto(out);
			this.oHash.update(out);
			this.oHash.digestInto(out);
			this.destroy();
		}
		digest() {
			const out = new Uint8Array(this.oHash.outputLen);
			this.digestInto(out);
			return out;
		}
		_cloneInto(to) {
			to ||= Object.create(Object.getPrototypeOf(this), {});
			const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
			to = to;
			to.finished = finished;
			to.destroyed = destroyed;
			to.blockLen = blockLen;
			to.outputLen = outputLen;
			to.oHash = oHash._cloneInto(to.oHash);
			to.iHash = iHash._cloneInto(to.iHash);
			return to;
		}
		clone() {
			return this._cloneInto();
		}
		destroy() {
			this.destroyed = true;
			this.oHash.destroy();
			this.iHash.destroy();
		}
	};
	hmac$1 = (hash, key, message) => new _HMAC$1(hash, key).update(message).digest();
	hmac$1.create = (hash, key) => new _HMAC$1(hash, key);
}));
//#endregion
//#region node_modules/nostr-tools/node_modules/@noble/curves/abstract/weierstrass.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
/**
* Splits scalar for GLV endomorphism.
*/
function _splitEndoScalar$1(k, basis, n) {
	const [[a1, b1], [a2, b2]] = basis;
	const c1 = divNearest$1(b2 * k, n);
	const c2 = divNearest$1(-b1 * k, n);
	let k1 = k - c1 * a1 - c2 * a2;
	let k2 = -c1 * b1 - c2 * b2;
	const k1neg = k1 < _0n$6;
	const k2neg = k2 < _0n$6;
	if (k1neg) k1 = -k1;
	if (k2neg) k2 = -k2;
	const MAX_NUM = bitMask$1(Math.ceil(bitLen$1(n) / 2)) + _1n$4;
	if (k1 < _0n$6 || k1 >= MAX_NUM || k2 < _0n$6 || k2 >= MAX_NUM) throw new Error("splitScalar (endomorphism): failed, k=" + k);
	return {
		k1neg,
		k1,
		k2neg,
		k2
	};
}
function validateSigFormat$1(format) {
	if (![
		"compact",
		"recovered",
		"der"
	].includes(format)) throw new Error("Signature format must be \"compact\", \"recovered\", or \"der\"");
	return format;
}
function validateSigOpts$1(opts, def) {
	const optsn = {};
	for (let optName of Object.keys(def)) optsn[optName] = opts[optName] === void 0 ? def[optName] : opts[optName];
	abool$2(optsn.lowS, "lowS");
	abool$2(optsn.prehash, "prehash");
	if (optsn.format !== void 0) validateSigFormat$1(optsn.format);
	return optsn;
}
/**
* Creates weierstrass Point constructor, based on specified curve options.
*
* See {@link WeierstrassOpts}.
*
* @example
```js
const opts = {
p: 0xfffffffffffffffffffffffffffffffeffffac73n,
n: 0x100000000000000000001b8fa16dfab9aca16b6b3n,
h: 1n,
a: 0n,
b: 7n,
Gx: 0x3b4c382ce37aa192a4019e763036f4f5dd4d7ebbn,
Gy: 0x938cf935318fdced6bc28286531733c3f03c4feen,
};
const secp160k1_Point = weierstrass(opts);
```
*/
function weierstrass$1(params, extraOpts = {}) {
	const validated = createCurveFields$1("weierstrass", params, extraOpts);
	const { Fp, Fn } = validated;
	let CURVE = validated.CURVE;
	const { h: cofactor, n: CURVE_ORDER } = CURVE;
	validateObject$1(extraOpts, {}, {
		allowInfinityPoint: "boolean",
		clearCofactor: "function",
		isTorsionFree: "function",
		fromBytes: "function",
		toBytes: "function",
		endo: "object"
	});
	const { endo } = extraOpts;
	if (endo) {
		if (!Fp.is0(CURVE.a) || typeof endo.beta !== "bigint" || !Array.isArray(endo.basises)) throw new Error("invalid endo: expected \"beta\": bigint and \"basises\": array");
	}
	const lengths = getWLengths$1(Fp, Fn);
	function assertCompressionIsSupported() {
		if (!Fp.isOdd) throw new Error("compression is not supported: Field does not have .isOdd()");
	}
	function pointToBytes(_c, point, isCompressed) {
		const { x, y } = point.toAffine();
		const bx = Fp.toBytes(x);
		abool$2(isCompressed, "isCompressed");
		if (isCompressed) {
			assertCompressionIsSupported();
			return concatBytes$2(pprefix$1(!Fp.isOdd(y)), bx);
		} else return concatBytes$2(Uint8Array.of(4), bx, Fp.toBytes(y));
	}
	function pointFromBytes(bytes) {
		abytes$4(bytes, void 0, "Point");
		const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
		const length = bytes.length;
		const head = bytes[0];
		const tail = bytes.subarray(1);
		if (length === comp && (head === 2 || head === 3)) {
			const x = Fp.fromBytes(tail);
			if (!Fp.isValid(x)) throw new Error("bad point: is not on curve, wrong x");
			const y2 = weierstrassEquation(x);
			let y;
			try {
				y = Fp.sqrt(y2);
			} catch (sqrtError) {
				const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
				throw new Error("bad point: is not on curve, sqrt error" + err);
			}
			assertCompressionIsSupported();
			const evenY = Fp.isOdd(y);
			if ((head & 1) === 1 !== evenY) y = Fp.neg(y);
			return {
				x,
				y
			};
		} else if (length === uncomp && head === 4) {
			const L = Fp.BYTES;
			const x = Fp.fromBytes(tail.subarray(0, L));
			const y = Fp.fromBytes(tail.subarray(L, L * 2));
			if (!isValidXY(x, y)) throw new Error("bad point: is not on curve");
			return {
				x,
				y
			};
		} else throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
	}
	const encodePoint = extraOpts.toBytes || pointToBytes;
	const decodePoint = extraOpts.fromBytes || pointFromBytes;
	function weierstrassEquation(x) {
		const x2 = Fp.sqr(x);
		const x3 = Fp.mul(x2, x);
		return Fp.add(Fp.add(x3, Fp.mul(x, CURVE.a)), CURVE.b);
	}
	/** Checks whether equation holds for given x, y: y² == x³ + ax + b */
	function isValidXY(x, y) {
		const left = Fp.sqr(y);
		const right = weierstrassEquation(x);
		return Fp.eql(left, right);
	}
	if (!isValidXY(CURVE.Gx, CURVE.Gy)) throw new Error("bad curve params: generator point");
	const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n$2), _4n$2);
	const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
	if (Fp.is0(Fp.add(_4a3, _27b2))) throw new Error("bad curve params: a or b");
	/** Asserts coordinate is valid: 0 <= n < Fp.ORDER. */
	function acoord(title, n, banZero = false) {
		if (!Fp.isValid(n) || banZero && Fp.is0(n)) throw new Error(`bad point coordinate ${title}`);
		return n;
	}
	function aprjpoint(other) {
		if (!(other instanceof Point)) throw new Error("Weierstrass Point expected");
	}
	function splitEndoScalarN(k) {
		if (!endo || !endo.basises) throw new Error("no endo");
		return _splitEndoScalar$1(k, endo.basises, Fn.ORDER);
	}
	const toAffineMemo = memoized((p, iz) => {
		const { X, Y, Z } = p;
		if (Fp.eql(Z, Fp.ONE)) return {
			x: X,
			y: Y
		};
		const is0 = p.is0();
		if (iz == null) iz = is0 ? Fp.ONE : Fp.inv(Z);
		const x = Fp.mul(X, iz);
		const y = Fp.mul(Y, iz);
		const zz = Fp.mul(Z, iz);
		if (is0) return {
			x: Fp.ZERO,
			y: Fp.ZERO
		};
		if (!Fp.eql(zz, Fp.ONE)) throw new Error("invZ was invalid");
		return {
			x,
			y
		};
	});
	const assertValidMemo = memoized((p) => {
		if (p.is0()) {
			if (extraOpts.allowInfinityPoint && !Fp.is0(p.Y)) return;
			throw new Error("bad point: ZERO");
		}
		const { x, y } = p.toAffine();
		if (!Fp.isValid(x) || !Fp.isValid(y)) throw new Error("bad point: x or y not field elements");
		if (!isValidXY(x, y)) throw new Error("bad point: equation left != right");
		if (!p.isTorsionFree()) throw new Error("bad point: not in prime-order subgroup");
		return true;
	});
	function finishEndo(endoBeta, k1p, k2p, k1neg, k2neg) {
		k2p = new Point(Fp.mul(k2p.X, endoBeta), k2p.Y, k2p.Z);
		k1p = negateCt$1(k1neg, k1p);
		k2p = negateCt$1(k2neg, k2p);
		return k1p.add(k2p);
	}
	/**
	* Projective Point works in 3d / projective (homogeneous) coordinates:(X, Y, Z) ∋ (x=X/Z, y=Y/Z).
	* Default Point works in 2d / affine coordinates: (x, y).
	* We're doing calculations in projective, because its operations don't require costly inversion.
	*/
	class Point {
		static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE);
		static ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO);
		static Fp = Fp;
		static Fn = Fn;
		X;
		Y;
		Z;
		/** Does NOT validate if the point is valid. Use `.assertValidity()`. */
		constructor(X, Y, Z) {
			this.X = acoord("x", X);
			this.Y = acoord("y", Y, true);
			this.Z = acoord("z", Z);
			Object.freeze(this);
		}
		static CURVE() {
			return CURVE;
		}
		/** Does NOT validate if the point is valid. Use `.assertValidity()`. */
		static fromAffine(p) {
			const { x, y } = p || {};
			if (!p || !Fp.isValid(x) || !Fp.isValid(y)) throw new Error("invalid affine point");
			if (p instanceof Point) throw new Error("projective point not allowed");
			if (Fp.is0(x) && Fp.is0(y)) return Point.ZERO;
			return new Point(x, y, Fp.ONE);
		}
		static fromBytes(bytes) {
			const P = Point.fromAffine(decodePoint(abytes$4(bytes, void 0, "point")));
			P.assertValidity();
			return P;
		}
		static fromHex(hex) {
			return Point.fromBytes(hexToBytes$2(hex));
		}
		get x() {
			return this.toAffine().x;
		}
		get y() {
			return this.toAffine().y;
		}
		/**
		*
		* @param windowSize
		* @param isLazy true will defer table computation until the first multiplication
		* @returns
		*/
		precompute(windowSize = 8, isLazy = true) {
			wnaf.createCache(this, windowSize);
			if (!isLazy) this.multiply(_3n$2);
			return this;
		}
		/** A point on curve is valid if it conforms to equation. */
		assertValidity() {
			assertValidMemo(this);
		}
		hasEvenY() {
			const { y } = this.toAffine();
			if (!Fp.isOdd) throw new Error("Field doesn't support isOdd");
			return !Fp.isOdd(y);
		}
		/** Compare one point to another. */
		equals(other) {
			aprjpoint(other);
			const { X: X1, Y: Y1, Z: Z1 } = this;
			const { X: X2, Y: Y2, Z: Z2 } = other;
			const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
			const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
			return U1 && U2;
		}
		/** Flips point to one corresponding to (x, -y) in Affine coordinates. */
		negate() {
			return new Point(this.X, Fp.neg(this.Y), this.Z);
		}
		double() {
			const { a, b } = CURVE;
			const b3 = Fp.mul(b, _3n$2);
			const { X: X1, Y: Y1, Z: Z1 } = this;
			let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
			let t0 = Fp.mul(X1, X1);
			let t1 = Fp.mul(Y1, Y1);
			let t2 = Fp.mul(Z1, Z1);
			let t3 = Fp.mul(X1, Y1);
			t3 = Fp.add(t3, t3);
			Z3 = Fp.mul(X1, Z1);
			Z3 = Fp.add(Z3, Z3);
			X3 = Fp.mul(a, Z3);
			Y3 = Fp.mul(b3, t2);
			Y3 = Fp.add(X3, Y3);
			X3 = Fp.sub(t1, Y3);
			Y3 = Fp.add(t1, Y3);
			Y3 = Fp.mul(X3, Y3);
			X3 = Fp.mul(t3, X3);
			Z3 = Fp.mul(b3, Z3);
			t2 = Fp.mul(a, t2);
			t3 = Fp.sub(t0, t2);
			t3 = Fp.mul(a, t3);
			t3 = Fp.add(t3, Z3);
			Z3 = Fp.add(t0, t0);
			t0 = Fp.add(Z3, t0);
			t0 = Fp.add(t0, t2);
			t0 = Fp.mul(t0, t3);
			Y3 = Fp.add(Y3, t0);
			t2 = Fp.mul(Y1, Z1);
			t2 = Fp.add(t2, t2);
			t0 = Fp.mul(t2, t3);
			X3 = Fp.sub(X3, t0);
			Z3 = Fp.mul(t2, t1);
			Z3 = Fp.add(Z3, Z3);
			Z3 = Fp.add(Z3, Z3);
			return new Point(X3, Y3, Z3);
		}
		add(other) {
			aprjpoint(other);
			const { X: X1, Y: Y1, Z: Z1 } = this;
			const { X: X2, Y: Y2, Z: Z2 } = other;
			let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
			const a = CURVE.a;
			const b3 = Fp.mul(CURVE.b, _3n$2);
			let t0 = Fp.mul(X1, X2);
			let t1 = Fp.mul(Y1, Y2);
			let t2 = Fp.mul(Z1, Z2);
			let t3 = Fp.add(X1, Y1);
			let t4 = Fp.add(X2, Y2);
			t3 = Fp.mul(t3, t4);
			t4 = Fp.add(t0, t1);
			t3 = Fp.sub(t3, t4);
			t4 = Fp.add(X1, Z1);
			let t5 = Fp.add(X2, Z2);
			t4 = Fp.mul(t4, t5);
			t5 = Fp.add(t0, t2);
			t4 = Fp.sub(t4, t5);
			t5 = Fp.add(Y1, Z1);
			X3 = Fp.add(Y2, Z2);
			t5 = Fp.mul(t5, X3);
			X3 = Fp.add(t1, t2);
			t5 = Fp.sub(t5, X3);
			Z3 = Fp.mul(a, t4);
			X3 = Fp.mul(b3, t2);
			Z3 = Fp.add(X3, Z3);
			X3 = Fp.sub(t1, Z3);
			Z3 = Fp.add(t1, Z3);
			Y3 = Fp.mul(X3, Z3);
			t1 = Fp.add(t0, t0);
			t1 = Fp.add(t1, t0);
			t2 = Fp.mul(a, t2);
			t4 = Fp.mul(b3, t4);
			t1 = Fp.add(t1, t2);
			t2 = Fp.sub(t0, t2);
			t2 = Fp.mul(a, t2);
			t4 = Fp.add(t4, t2);
			t0 = Fp.mul(t1, t4);
			Y3 = Fp.add(Y3, t0);
			t0 = Fp.mul(t5, t4);
			X3 = Fp.mul(t3, X3);
			X3 = Fp.sub(X3, t0);
			t0 = Fp.mul(t3, t1);
			Z3 = Fp.mul(t5, Z3);
			Z3 = Fp.add(Z3, t0);
			return new Point(X3, Y3, Z3);
		}
		subtract(other) {
			return this.add(other.negate());
		}
		is0() {
			return this.equals(Point.ZERO);
		}
		/**
		* Constant time multiplication.
		* Uses wNAF method. Windowed method may be 10% faster,
		* but takes 2x longer to generate and consumes 2x memory.
		* Uses precomputes when available.
		* Uses endomorphism for Koblitz curves.
		* @param scalar by which the point would be multiplied
		* @returns New point
		*/
		multiply(scalar) {
			const { endo } = extraOpts;
			if (!Fn.isValidNot0(scalar)) throw new Error("invalid scalar: out of range");
			let point, fake;
			const mul = (n) => wnaf.cached(this, n, (p) => normalizeZ$1(Point, p));
			/** See docs for {@link EndomorphismOpts} */
			if (endo) {
				const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(scalar);
				const { p: k1p, f: k1f } = mul(k1);
				const { p: k2p, f: k2f } = mul(k2);
				fake = k1f.add(k2f);
				point = finishEndo(endo.beta, k1p, k2p, k1neg, k2neg);
			} else {
				const { p, f } = mul(scalar);
				point = p;
				fake = f;
			}
			return normalizeZ$1(Point, [point, fake])[0];
		}
		/**
		* Non-constant-time multiplication. Uses double-and-add algorithm.
		* It's faster, but should only be used when you don't care about
		* an exposed secret key e.g. sig verification, which works over *public* keys.
		*/
		multiplyUnsafe(sc) {
			const { endo } = extraOpts;
			const p = this;
			if (!Fn.isValid(sc)) throw new Error("invalid scalar: out of range");
			if (sc === _0n$6 || p.is0()) return Point.ZERO;
			if (sc === _1n$4) return p;
			if (wnaf.hasCache(this)) return this.multiply(sc);
			if (endo) {
				const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(sc);
				const { p1, p2 } = mulEndoUnsafe$1(Point, p, k1, k2);
				return finishEndo(endo.beta, p1, p2, k1neg, k2neg);
			} else return wnaf.unsafe(p, sc);
		}
		/**
		* Converts Projective point to affine (x, y) coordinates.
		* @param invertedZ Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
		*/
		toAffine(invertedZ) {
			return toAffineMemo(this, invertedZ);
		}
		/**
		* Checks whether Point is free of torsion elements (is in prime subgroup).
		* Always torsion-free for cofactor=1 curves.
		*/
		isTorsionFree() {
			const { isTorsionFree } = extraOpts;
			if (cofactor === _1n$4) return true;
			if (isTorsionFree) return isTorsionFree(Point, this);
			return wnaf.unsafe(this, CURVE_ORDER).is0();
		}
		clearCofactor() {
			const { clearCofactor } = extraOpts;
			if (cofactor === _1n$4) return this;
			if (clearCofactor) return clearCofactor(Point, this);
			return this.multiplyUnsafe(cofactor);
		}
		isSmallOrder() {
			return this.multiplyUnsafe(cofactor).is0();
		}
		toBytes(isCompressed = true) {
			abool$2(isCompressed, "isCompressed");
			this.assertValidity();
			return encodePoint(Point, this, isCompressed);
		}
		toHex(isCompressed = true) {
			return bytesToHex$2(this.toBytes(isCompressed));
		}
		toString() {
			return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
		}
	}
	const bits = Fn.BITS;
	const wnaf = new wNAF$1(Point, extraOpts.endo ? Math.ceil(bits / 2) : bits);
	Point.BASE.precompute(8);
	return Point;
}
function pprefix$1(hasEvenY) {
	return Uint8Array.of(hasEvenY ? 2 : 3);
}
function getWLengths$1(Fp, Fn) {
	return {
		secretKey: Fn.BYTES,
		publicKey: 1 + Fp.BYTES,
		publicKeyUncompressed: 1 + 2 * Fp.BYTES,
		publicKeyHasPrefix: true,
		signature: 2 * Fn.BYTES
	};
}
/**
* Sometimes users only need getPublicKey, getSharedSecret, and secret key handling.
* This helper ensures no signature functionality is present. Less code, smaller bundle size.
*/
function ecdh$1(Point, ecdhOpts = {}) {
	const { Fn } = Point;
	const randomBytes_ = ecdhOpts.randomBytes || randomBytes$2;
	const lengths = Object.assign(getWLengths$1(Point.Fp, Fn), { seed: getMinHashLength$1(Fn.ORDER) });
	function isValidSecretKey(secretKey) {
		try {
			const num = Fn.fromBytes(secretKey);
			return Fn.isValidNot0(num);
		} catch (error) {
			return false;
		}
	}
	function isValidPublicKey(publicKey, isCompressed) {
		const { publicKey: comp, publicKeyUncompressed } = lengths;
		try {
			const l = publicKey.length;
			if (isCompressed === true && l !== comp) return false;
			if (isCompressed === false && l !== publicKeyUncompressed) return false;
			return !!Point.fromBytes(publicKey);
		} catch (error) {
			return false;
		}
	}
	/**
	* Produces cryptographically secure secret key from random of size
	* (groupLen + ceil(groupLen / 2)) with modulo bias being negligible.
	*/
	function randomSecretKey(seed = randomBytes_(lengths.seed)) {
		return mapHashToField$1(abytes$4(seed, lengths.seed, "seed"), Fn.ORDER);
	}
	/**
	* Computes public key for a secret key. Checks for validity of the secret key.
	* @param isCompressed whether to return compact (default), or full key
	* @returns Public key, full when isCompressed=false; short when isCompressed=true
	*/
	function getPublicKey(secretKey, isCompressed = true) {
		return Point.BASE.multiply(Fn.fromBytes(secretKey)).toBytes(isCompressed);
	}
	/**
	* Quick and dirty check for item being public key. Does not validate hex, or being on-curve.
	*/
	function isProbPub(item) {
		const { secretKey, publicKey, publicKeyUncompressed } = lengths;
		if (!isBytes$4(item)) return void 0;
		if ("_lengths" in Fn && Fn._lengths || secretKey === publicKey) return void 0;
		const l = abytes$4(item, void 0, "key").length;
		return l === publicKey || l === publicKeyUncompressed;
	}
	/**
	* ECDH (Elliptic Curve Diffie Hellman).
	* Computes shared public key from secret key A and public key B.
	* Checks: 1) secret key validity 2) shared key is on-curve.
	* Does NOT hash the result.
	* @param isCompressed whether to return compact (default), or full key
	* @returns shared public key
	*/
	function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
		if (isProbPub(secretKeyA) === true) throw new Error("first arg must be private key");
		if (isProbPub(publicKeyB) === false) throw new Error("second arg must be public key");
		const s = Fn.fromBytes(secretKeyA);
		return Point.fromBytes(publicKeyB).multiply(s).toBytes(isCompressed);
	}
	const utils = {
		isValidSecretKey,
		isValidPublicKey,
		randomSecretKey
	};
	const keygen = createKeygen$1(randomSecretKey, getPublicKey);
	return Object.freeze({
		getPublicKey,
		getSharedSecret,
		keygen,
		Point,
		utils,
		lengths
	});
}
/**
* Creates ECDSA signing interface for given elliptic curve `Point` and `hash` function.
*
* @param Point created using {@link weierstrass} function
* @param hash used for 1) message prehash-ing 2) k generation in `sign`, using hmac_drbg(hash)
* @param ecdsaOpts rarely needed, see {@link ECDSAOpts}
*
* @example
* ```js
* const p256_Point = weierstrass(...);
* const p256_sha256 = ecdsa(p256_Point, sha256);
* const p256_sha224 = ecdsa(p256_Point, sha224);
* const p256_sha224_r = ecdsa(p256_Point, sha224, { randomBytes: (length) => { ... } });
* ```
*/
function ecdsa$1(Point, hash, ecdsaOpts = {}) {
	ahash$1(hash);
	validateObject$1(ecdsaOpts, {}, {
		hmac: "function",
		lowS: "boolean",
		randomBytes: "function",
		bits2int: "function",
		bits2int_modN: "function"
	});
	ecdsaOpts = Object.assign({}, ecdsaOpts);
	const randomBytes = ecdsaOpts.randomBytes || randomBytes$2;
	const hmac = ecdsaOpts.hmac || ((key, msg) => hmac$1(hash, key, msg));
	const { Fp, Fn } = Point;
	const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn;
	const { keygen, getPublicKey, getSharedSecret, utils, lengths } = ecdh$1(Point, ecdsaOpts);
	const defaultSigOpts = {
		prehash: true,
		lowS: typeof ecdsaOpts.lowS === "boolean" ? ecdsaOpts.lowS : true,
		format: "compact",
		extraEntropy: false
	};
	const hasLargeCofactor = CURVE_ORDER * _2n$4 < Fp.ORDER;
	function isBiggerThanHalfOrder(number) {
		return number > CURVE_ORDER >> _1n$4;
	}
	function validateRS(title, num) {
		if (!Fn.isValidNot0(num)) throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
		return num;
	}
	function assertSmallCofactor() {
		if (hasLargeCofactor) throw new Error("\"recovered\" sig type is not supported for cofactor >2 curves");
	}
	function validateSigLength(bytes, format) {
		validateSigFormat$1(format);
		const size = lengths.signature;
		return abytes$4(bytes, format === "compact" ? size : format === "recovered" ? size + 1 : void 0);
	}
	/**
	* ECDSA signature with its (r, s) properties. Supports compact, recovered & DER representations.
	*/
	class Signature {
		r;
		s;
		recovery;
		constructor(r, s, recovery) {
			this.r = validateRS("r", r);
			this.s = validateRS("s", s);
			if (recovery != null) {
				assertSmallCofactor();
				if (![
					0,
					1,
					2,
					3
				].includes(recovery)) throw new Error("invalid recovery id");
				this.recovery = recovery;
			}
			Object.freeze(this);
		}
		static fromBytes(bytes, format = defaultSigOpts.format) {
			validateSigLength(bytes, format);
			let recid;
			if (format === "der") {
				const { r, s } = DER$1.toSig(abytes$4(bytes));
				return new Signature(r, s);
			}
			if (format === "recovered") {
				recid = bytes[0];
				format = "compact";
				bytes = bytes.subarray(1);
			}
			const L = lengths.signature / 2;
			const r = bytes.subarray(0, L);
			const s = bytes.subarray(L, L * 2);
			return new Signature(Fn.fromBytes(r), Fn.fromBytes(s), recid);
		}
		static fromHex(hex, format) {
			return this.fromBytes(hexToBytes$2(hex), format);
		}
		assertRecovery() {
			const { recovery } = this;
			if (recovery == null) throw new Error("invalid recovery id: must be present");
			return recovery;
		}
		addRecoveryBit(recovery) {
			return new Signature(this.r, this.s, recovery);
		}
		recoverPublicKey(messageHash) {
			const { r, s } = this;
			const recovery = this.assertRecovery();
			const radj = recovery === 2 || recovery === 3 ? r + CURVE_ORDER : r;
			if (!Fp.isValid(radj)) throw new Error("invalid recovery id: sig.r+curve.n != R.x");
			const x = Fp.toBytes(radj);
			const R = Point.fromBytes(concatBytes$2(pprefix$1((recovery & 1) === 0), x));
			const ir = Fn.inv(radj);
			const h = bits2int_modN(abytes$4(messageHash, void 0, "msgHash"));
			const u1 = Fn.create(-h * ir);
			const u2 = Fn.create(s * ir);
			const Q = Point.BASE.multiplyUnsafe(u1).add(R.multiplyUnsafe(u2));
			if (Q.is0()) throw new Error("invalid recovery: point at infinify");
			Q.assertValidity();
			return Q;
		}
		hasHighS() {
			return isBiggerThanHalfOrder(this.s);
		}
		toBytes(format = defaultSigOpts.format) {
			validateSigFormat$1(format);
			if (format === "der") return hexToBytes$2(DER$1.hexFromSig(this));
			const { r, s } = this;
			const rb = Fn.toBytes(r);
			const sb = Fn.toBytes(s);
			if (format === "recovered") {
				assertSmallCofactor();
				return concatBytes$2(Uint8Array.of(this.assertRecovery()), rb, sb);
			}
			return concatBytes$2(rb, sb);
		}
		toHex(format) {
			return bytesToHex$2(this.toBytes(format));
		}
	}
	const bits2int = ecdsaOpts.bits2int || function bits2int_def(bytes) {
		if (bytes.length > 8192) throw new Error("input is too large");
		const num = bytesToNumberBE$1(bytes);
		const delta = bytes.length * 8 - fnBits;
		return delta > 0 ? num >> BigInt(delta) : num;
	};
	const bits2int_modN = ecdsaOpts.bits2int_modN || function bits2int_modN_def(bytes) {
		return Fn.create(bits2int(bytes));
	};
	const ORDER_MASK = bitMask$1(fnBits);
	/** Converts to bytes. Checks if num in `[0..ORDER_MASK-1]` e.g.: `[0..2^256-1]`. */
	function int2octets(num) {
		aInRange$1("num < 2^" + fnBits, num, _0n$6, ORDER_MASK);
		return Fn.toBytes(num);
	}
	function validateMsgAndHash(message, prehash) {
		abytes$4(message, void 0, "message");
		return prehash ? abytes$4(hash(message), void 0, "prehashed message") : message;
	}
	/**
	* Steps A, D of RFC6979 3.2.
	* Creates RFC6979 seed; converts msg/privKey to numbers.
	* Used only in sign, not in verify.
	*
	* Warning: we cannot assume here that message has same amount of bytes as curve order,
	* this will be invalid at least for P521. Also it can be bigger for P224 + SHA256.
	*/
	function prepSig(message, secretKey, opts) {
		const { lowS, prehash, extraEntropy } = validateSigOpts$1(opts, defaultSigOpts);
		message = validateMsgAndHash(message, prehash);
		const h1int = bits2int_modN(message);
		const d = Fn.fromBytes(secretKey);
		if (!Fn.isValidNot0(d)) throw new Error("invalid private key");
		const seedArgs = [int2octets(d), int2octets(h1int)];
		if (extraEntropy != null && extraEntropy !== false) {
			const e = extraEntropy === true ? randomBytes(lengths.secretKey) : extraEntropy;
			seedArgs.push(abytes$4(e, void 0, "extraEntropy"));
		}
		const seed = concatBytes$2(...seedArgs);
		const m = h1int;
		function k2sig(kBytes) {
			const k = bits2int(kBytes);
			if (!Fn.isValidNot0(k)) return;
			const ik = Fn.inv(k);
			const q = Point.BASE.multiply(k).toAffine();
			const r = Fn.create(q.x);
			if (r === _0n$6) return;
			const s = Fn.create(ik * Fn.create(m + r * d));
			if (s === _0n$6) return;
			let recovery = (q.x === r ? 0 : 2) | Number(q.y & _1n$4);
			let normS = s;
			if (lowS && isBiggerThanHalfOrder(s)) {
				normS = Fn.neg(s);
				recovery ^= 1;
			}
			return new Signature(r, normS, hasLargeCofactor ? void 0 : recovery);
		}
		return {
			seed,
			k2sig
		};
	}
	/**
	* Signs message hash with a secret key.
	*
	* ```
	* sign(m, d) where
	*   k = rfc6979_hmac_drbg(m, d)
	*   (x, y) = G × k
	*   r = x mod n
	*   s = (m + dr) / k mod n
	* ```
	*/
	function sign(message, secretKey, opts = {}) {
		const { seed, k2sig } = prepSig(message, secretKey, opts);
		return createHmacDrbg$1(hash.outputLen, Fn.BYTES, hmac)(seed, k2sig).toBytes(opts.format);
	}
	/**
	* Verifies a signature against message and public key.
	* Rejects lowS signatures by default: see {@link ECDSAVerifyOpts}.
	* Implements section 4.1.4 from https://www.secg.org/sec1-v2.pdf:
	*
	* ```
	* verify(r, s, h, P) where
	*   u1 = hs^-1 mod n
	*   u2 = rs^-1 mod n
	*   R = u1⋅G + u2⋅P
	*   mod(R.x, n) == r
	* ```
	*/
	function verify(signature, message, publicKey, opts = {}) {
		const { lowS, prehash, format } = validateSigOpts$1(opts, defaultSigOpts);
		publicKey = abytes$4(publicKey, void 0, "publicKey");
		message = validateMsgAndHash(message, prehash);
		if (!isBytes$4(signature)) {
			const end = signature instanceof Signature ? ", use sig.toBytes()" : "";
			throw new Error("verify expects Uint8Array signature" + end);
		}
		validateSigLength(signature, format);
		try {
			const sig = Signature.fromBytes(signature, format);
			const P = Point.fromBytes(publicKey);
			if (lowS && sig.hasHighS()) return false;
			const { r, s } = sig;
			const h = bits2int_modN(message);
			const is = Fn.inv(s);
			const u1 = Fn.create(h * is);
			const u2 = Fn.create(r * is);
			const R = Point.BASE.multiplyUnsafe(u1).add(P.multiplyUnsafe(u2));
			if (R.is0()) return false;
			return Fn.create(R.x) === r;
		} catch (e) {
			return false;
		}
	}
	function recoverPublicKey(signature, message, opts = {}) {
		const { prehash } = validateSigOpts$1(opts, defaultSigOpts);
		message = validateMsgAndHash(message, prehash);
		return Signature.fromBytes(signature, "recovered").recoverPublicKey(message).toBytes();
	}
	return Object.freeze({
		keygen,
		getPublicKey,
		getSharedSecret,
		utils,
		lengths,
		Point,
		sign,
		verify,
		recoverPublicKey,
		Signature,
		hash
	});
}
var divNearest$1, DERErr$1, DER$1, _0n$6, _1n$4, _2n$4, _3n$2, _4n$2;
var init_weierstrass = __esmMin((() => {
	init_hmac();
	init_utils$1();
	init_utils();
	init_curve();
	init_modular();
	divNearest$1 = (num, den) => (num + (num >= 0 ? den : -den) / _2n$4) / den;
	DERErr$1 = class extends Error {
		constructor(m = "") {
			super(m);
		}
	};
	DER$1 = {
		Err: DERErr$1,
		_tlv: {
			encode: (tag, data) => {
				const { Err: E } = DER$1;
				if (tag < 0 || tag > 256) throw new E("tlv.encode: wrong tag");
				if (data.length & 1) throw new E("tlv.encode: unpadded data");
				const dataLen = data.length / 2;
				const len = numberToHexUnpadded$1(dataLen);
				if (len.length / 2 & 128) throw new E("tlv.encode: long form length too big");
				const lenLen = dataLen > 127 ? numberToHexUnpadded$1(len.length / 2 | 128) : "";
				return numberToHexUnpadded$1(tag) + lenLen + len + data;
			},
			decode(tag, data) {
				const { Err: E } = DER$1;
				let pos = 0;
				if (tag < 0 || tag > 256) throw new E("tlv.encode: wrong tag");
				if (data.length < 2 || data[pos++] !== tag) throw new E("tlv.decode: wrong tlv");
				const first = data[pos++];
				const isLong = !!(first & 128);
				let length = 0;
				if (!isLong) length = first;
				else {
					const lenLen = first & 127;
					if (!lenLen) throw new E("tlv.decode(long): indefinite length not supported");
					if (lenLen > 4) throw new E("tlv.decode(long): byte length is too big");
					const lengthBytes = data.subarray(pos, pos + lenLen);
					if (lengthBytes.length !== lenLen) throw new E("tlv.decode: length bytes not complete");
					if (lengthBytes[0] === 0) throw new E("tlv.decode(long): zero leftmost byte");
					for (const b of lengthBytes) length = length << 8 | b;
					pos += lenLen;
					if (length < 128) throw new E("tlv.decode(long): not minimal encoding");
				}
				const v = data.subarray(pos, pos + length);
				if (v.length !== length) throw new E("tlv.decode: wrong value length");
				return {
					v,
					l: data.subarray(pos + length)
				};
			}
		},
		_int: {
			encode(num) {
				const { Err: E } = DER$1;
				if (num < _0n$6) throw new E("integer: negative integers are not allowed");
				let hex = numberToHexUnpadded$1(num);
				if (Number.parseInt(hex[0], 16) & 8) hex = "00" + hex;
				if (hex.length & 1) throw new E("unexpected DER parsing assertion: unpadded hex");
				return hex;
			},
			decode(data) {
				const { Err: E } = DER$1;
				if (data[0] & 128) throw new E("invalid signature integer: negative");
				if (data[0] === 0 && !(data[1] & 128)) throw new E("invalid signature integer: unnecessary leading zero");
				return bytesToNumberBE$1(data);
			}
		},
		toSig(bytes) {
			const { Err: E, _int: int, _tlv: tlv } = DER$1;
			const data = abytes$4(bytes, void 0, "signature");
			const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
			if (seqLeftBytes.length) throw new E("invalid signature: left bytes after parsing");
			const { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes);
			const { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
			if (sLeftBytes.length) throw new E("invalid signature: left bytes after parsing");
			return {
				r: int.decode(rBytes),
				s: int.decode(sBytes)
			};
		},
		hexFromSig(sig) {
			const { _tlv: tlv, _int: int } = DER$1;
			const seq = tlv.encode(2, int.encode(sig.r)) + tlv.encode(2, int.encode(sig.s));
			return tlv.encode(48, seq);
		}
	};
	_0n$6 = BigInt(0), _1n$4 = BigInt(1), _2n$4 = BigInt(2), _3n$2 = BigInt(3), _4n$2 = BigInt(4);
}));
//#endregion
//#region node_modules/nostr-tools/node_modules/@noble/curves/secp256k1.js
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
/**
* √n = n^((p+1)/4) for fields p = 3 mod 4. We unwrap the loop and multiply bit-by-bit.
* (P+1n/4n).toString(2) would produce bits [223x 1, 0, 22x 1, 4x 0, 11, 00]
*/
function sqrtMod$1(y) {
	const P = secp256k1_CURVE$1.p;
	const _3n = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22);
	const _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88);
	const b2 = y * y * y % P;
	const b3 = b2 * b2 * y % P;
	const b11 = pow2$1(pow2$1(pow2$1(b3, _3n, P) * b3 % P, _3n, P) * b3 % P, _2n$3, P) * b2 % P;
	const b22 = pow2$1(b11, _11n, P) * b11 % P;
	const b44 = pow2$1(b22, _22n, P) * b22 % P;
	const b88 = pow2$1(b44, _44n, P) * b44 % P;
	const root = pow2$1(pow2$1(pow2$1(pow2$1(pow2$1(pow2$1(b88, _88n, P) * b88 % P, _44n, P) * b44 % P, _3n, P) * b3 % P, _23n, P) * b22 % P, _6n, P) * b2 % P, _2n$3, P);
	if (!Fpk1$1.eql(Fpk1$1.sqr(root), y)) throw new Error("Cannot find square root");
	return root;
}
function taggedHash$1(tag, ...messages) {
	let tagP = TAGGED_HASH_PREFIXES$1[tag];
	if (tagP === void 0) {
		const tagH = sha256$1(asciiToBytes$1(tag));
		tagP = concatBytes$2(tagH, tagH);
		TAGGED_HASH_PREFIXES$1[tag] = tagP;
	}
	return sha256$1(concatBytes$2(tagP, ...messages));
}
function schnorrGetExtPubKey$1(priv) {
	const { Fn, BASE } = Pointk1$1;
	const d_ = Fn.fromBytes(priv);
	const p = BASE.multiply(d_);
	return {
		scalar: hasEven$1(p.y) ? d_ : Fn.neg(d_),
		bytes: pointToBytes$1(p)
	};
}
/**
* lift_x from BIP340. Convert 32-byte x coordinate to elliptic curve point.
* @returns valid point checked for being on-curve
*/
function lift_x$1(x) {
	const Fp = Fpk1$1;
	if (!Fp.isValidNot0(x)) throw new Error("invalid x: Fail if x ≥ p");
	const xx = Fp.create(x * x);
	const c = Fp.create(xx * x + BigInt(7));
	let y = Fp.sqrt(c);
	if (!hasEven$1(y)) y = Fp.neg(y);
	const p = Pointk1$1.fromAffine({
		x,
		y
	});
	p.assertValidity();
	return p;
}
/**
* Create tagged hash, convert it to bigint, reduce modulo-n.
*/
function challenge$1(...args) {
	return Pointk1$1.Fn.create(num$1(taggedHash$1("BIP0340/challenge", ...args)));
}
/**
* Schnorr public key is just `x` coordinate of Point as per BIP340.
*/
function schnorrGetPublicKey$1(secretKey) {
	return schnorrGetExtPubKey$1(secretKey).bytes;
}
/**
* Creates Schnorr signature as per BIP340. Verifies itself before returning anything.
* auxRand is optional and is not the sole source of k generation: bad CSPRNG won't be dangerous.
*/
function schnorrSign$1(message, secretKey, auxRand = randomBytes$2(32)) {
	const { Fn } = Pointk1$1;
	const m = abytes$4(message, void 0, "message");
	const { bytes: px, scalar: d } = schnorrGetExtPubKey$1(secretKey);
	const a = abytes$4(auxRand, 32, "auxRand");
	const { bytes: rx, scalar: k } = schnorrGetExtPubKey$1(taggedHash$1("BIP0340/nonce", Fn.toBytes(d ^ num$1(taggedHash$1("BIP0340/aux", a))), px, m));
	const e = challenge$1(rx, px, m);
	const sig = new Uint8Array(64);
	sig.set(rx, 0);
	sig.set(Fn.toBytes(Fn.create(k + e * d)), 32);
	if (!schnorrVerify$1(sig, m, px)) throw new Error("sign: Invalid signature produced");
	return sig;
}
/**
* Verifies Schnorr signature.
* Will swallow errors & return false except for initial type validation of arguments.
*/
function schnorrVerify$1(signature, message, publicKey) {
	const { Fp, Fn, BASE } = Pointk1$1;
	const sig = abytes$4(signature, 64, "signature");
	const m = abytes$4(message, void 0, "message");
	const pub = abytes$4(publicKey, 32, "publicKey");
	try {
		const P = lift_x$1(num$1(pub));
		const r = num$1(sig.subarray(0, 32));
		if (!Fp.isValidNot0(r)) return false;
		const s = num$1(sig.subarray(32, 64));
		if (!Fn.isValidNot0(s)) return false;
		const e = challenge$1(Fn.toBytes(r), pointToBytes$1(P), m);
		const R = BASE.multiplyUnsafe(s).add(P.multiplyUnsafe(Fn.neg(e)));
		const { x, y } = R.toAffine();
		if (R.is0() || !hasEven$1(y) || x !== r) return false;
		return true;
	} catch (error) {
		return false;
	}
}
var secp256k1_CURVE$1, secp256k1_ENDO$1, _0n$5, _2n$3, Fpk1$1, Pointk1$1, secp256k1$1, TAGGED_HASH_PREFIXES$1, pointToBytes$1, hasEven$1, num$1, schnorr$1;
var init_secp256k1 = __esmMin((() => {
	init_sha2();
	init_utils$1();
	init_curve();
	init_modular();
	init_weierstrass();
	init_utils();
	secp256k1_CURVE$1 = {
		p: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"),
		n: BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
		h: BigInt(1),
		a: BigInt(0),
		b: BigInt(7),
		Gx: BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
		Gy: BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8")
	};
	secp256k1_ENDO$1 = {
		beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
		basises: [[BigInt("0x3086d221a7d46bcde86c90e49284eb15"), -BigInt("0xe4437ed6010e88286f547fa90abfe4c3")], [BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8"), BigInt("0x3086d221a7d46bcde86c90e49284eb15")]]
	};
	_0n$5 = /* @__PURE__ */ BigInt(0);
	_2n$3 = /* @__PURE__ */ BigInt(2);
	Fpk1$1 = Field$1(secp256k1_CURVE$1.p, { sqrt: sqrtMod$1 });
	Pointk1$1 = /* @__PURE__ */ weierstrass$1(secp256k1_CURVE$1, {
		Fp: Fpk1$1,
		endo: secp256k1_ENDO$1
	});
	secp256k1$1 = /* @__PURE__ */ ecdsa$1(Pointk1$1, sha256$1);
	TAGGED_HASH_PREFIXES$1 = {};
	pointToBytes$1 = (point) => point.toBytes(true).slice(1);
	hasEven$1 = (y) => y % _2n$3 === _0n$5;
	num$1 = bytesToNumberBE$1;
	schnorr$1 = /* @__PURE__ */ (() => {
		const size = 32;
		const seedLength = 48;
		const randomSecretKey = (seed = randomBytes$2(seedLength)) => {
			return mapHashToField$1(seed, secp256k1_CURVE$1.n);
		};
		return {
			keygen: createKeygen$1(randomSecretKey, schnorrGetPublicKey$1),
			getPublicKey: schnorrGetPublicKey$1,
			sign: schnorrSign$1,
			verify: schnorrVerify$1,
			Point: Pointk1$1,
			utils: {
				randomSecretKey,
				taggedHash: taggedHash$1,
				lift_x: lift_x$1,
				pointToBytes: pointToBytes$1
			},
			lengths: {
				secretKey: size,
				publicKey: size,
				publicKeyHasPrefix: false,
				signature: size * 2,
				seed: seedLength
			}
		};
	})();
}));
//#endregion
//#region node_modules/nostr-tools/lib/esm/pure.js
var pure_exports = /* @__PURE__ */ __exportAll({
	finalizeEvent: () => finalizeEvent$1,
	generateSecretKey: () => generateSecretKey$1,
	getEventHash: () => getEventHash$2,
	getPublicKey: () => getPublicKey$1,
	serializeEvent: () => serializeEvent$2,
	sortEvents: () => sortEvents,
	validateEvent: () => validateEvent$2,
	verifiedSymbol: () => verifiedSymbol$2,
	verifyEvent: () => verifyEvent$2
});
function validateEvent$2(event) {
	if (!isRecord$2(event)) return false;
	if (typeof event.kind !== "number") return false;
	if (typeof event.content !== "string") return false;
	if (typeof event.created_at !== "number") return false;
	if (typeof event.pubkey !== "string") return false;
	if (!event.pubkey.match(/^[a-f0-9]{64}$/)) return false;
	if (!Array.isArray(event.tags)) return false;
	for (let i2 = 0; i2 < event.tags.length; i2++) {
		let tag = event.tags[i2];
		if (!Array.isArray(tag)) return false;
		for (let j = 0; j < tag.length; j++) if (typeof tag[j] !== "string") return false;
	}
	return true;
}
function sortEvents(events) {
	return events.sort((a, b) => {
		if (a.created_at !== b.created_at) return b.created_at - a.created_at;
		return a.id.localeCompare(b.id);
	});
}
function serializeEvent$2(evt) {
	if (!validateEvent$2(evt)) throw new Error("can't serialize event with wrong or missing properties");
	return JSON.stringify([
		0,
		evt.pubkey,
		evt.created_at,
		evt.kind,
		evt.tags,
		evt.content
	]);
}
function getEventHash$2(event) {
	return bytesToHex$2(sha256$1(utf8Encoder$4.encode(serializeEvent$2(event))));
}
var verifiedSymbol$2, isRecord$2, utf8Encoder$4, JS$2, i$2, generateSecretKey$1, getPublicKey$1, finalizeEvent$1, verifyEvent$2;
var init_pure = __esmMin((() => {
	init_secp256k1();
	init_utils$1();
	init_sha2();
	verifiedSymbol$2 = Symbol("verified");
	isRecord$2 = (obj) => obj instanceof Object;
	new TextDecoder("utf-8");
	utf8Encoder$4 = new TextEncoder();
	JS$2 = class {
		generateSecretKey() {
			return schnorr$1.utils.randomSecretKey();
		}
		getPublicKey(secretKey) {
			return bytesToHex$2(schnorr$1.getPublicKey(secretKey));
		}
		finalizeEvent(t, secretKey) {
			const event = t;
			event.pubkey = bytesToHex$2(schnorr$1.getPublicKey(secretKey));
			event.id = getEventHash$2(event);
			event.sig = bytesToHex$2(schnorr$1.sign(hexToBytes$2(getEventHash$2(event)), secretKey));
			event[verifiedSymbol$2] = true;
			return event;
		}
		verifyEvent(event) {
			if (typeof event[verifiedSymbol$2] === "boolean") return event[verifiedSymbol$2];
			try {
				const hash = getEventHash$2(event);
				if (hash !== event.id) {
					event[verifiedSymbol$2] = false;
					return false;
				}
				const valid = schnorr$1.verify(hexToBytes$2(event.sig), hexToBytes$2(hash), hexToBytes$2(event.pubkey));
				event[verifiedSymbol$2] = valid;
				return valid;
			} catch (err) {
				event[verifiedSymbol$2] = false;
				return false;
			}
		}
	};
	i$2 = new JS$2();
	generateSecretKey$1 = i$2.generateSecretKey;
	getPublicKey$1 = i$2.getPublicKey;
	finalizeEvent$1 = i$2.finalizeEvent;
	verifyEvent$2 = i$2.verifyEvent;
}));
//#endregion
//#region node_modules/nostr-tools/node_modules/@scure/base/index.js
init_pure();
/*! scure-base - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function isBytes$3(a) {
	return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
/** Asserts something is Uint8Array. */
function abytes$3(b) {
	if (!isBytes$3(b)) throw new Error("Uint8Array expected");
}
function isArrayOf(isString, arr) {
	if (!Array.isArray(arr)) return false;
	if (arr.length === 0) return true;
	if (isString) return arr.every((item) => typeof item === "string");
	else return arr.every((item) => Number.isSafeInteger(item));
}
function afn(input) {
	if (typeof input !== "function") throw new Error("function expected");
	return true;
}
function astr(label, input) {
	if (typeof input !== "string") throw new Error(`${label}: string expected`);
	return true;
}
function anumber$3(n) {
	if (!Number.isSafeInteger(n)) throw new Error(`invalid integer: ${n}`);
}
function aArr(input) {
	if (!Array.isArray(input)) throw new Error("array expected");
}
function astrArr(label, input) {
	if (!isArrayOf(true, input)) throw new Error(`${label}: array of strings expected`);
}
function anumArr(label, input) {
	if (!isArrayOf(false, input)) throw new Error(`${label}: array of numbers expected`);
}
/**
* @__NO_SIDE_EFFECTS__
*/
function chain(...args) {
	const id = (a) => a;
	const wrap = (a, b) => (c) => a(b(c));
	return {
		encode: args.map((x) => x.encode).reduceRight(wrap, id),
		decode: args.map((x) => x.decode).reduce(wrap, id)
	};
}
/**
* Encodes integer radix representation to array of strings using alphabet and back.
* Could also be array of strings.
* @__NO_SIDE_EFFECTS__
*/
function alphabet(letters) {
	const lettersA = typeof letters === "string" ? letters.split("") : letters;
	const len = lettersA.length;
	astrArr("alphabet", lettersA);
	const indexes = new Map(lettersA.map((l, i) => [l, i]));
	return {
		encode: (digits) => {
			aArr(digits);
			return digits.map((i) => {
				if (!Number.isSafeInteger(i) || i < 0 || i >= len) throw new Error(`alphabet.encode: digit index outside alphabet "${i}". Allowed: ${letters}`);
				return lettersA[i];
			});
		},
		decode: (input) => {
			aArr(input);
			return input.map((letter) => {
				astr("alphabet.decode", letter);
				const i = indexes.get(letter);
				if (i === void 0) throw new Error(`Unknown letter: "${letter}". Allowed: ${letters}`);
				return i;
			});
		}
	};
}
/**
* @__NO_SIDE_EFFECTS__
*/
function join$1(separator = "") {
	astr("join", separator);
	return {
		encode: (from) => {
			astrArr("join.decode", from);
			return from.join(separator);
		},
		decode: (to) => {
			astr("join.decode", to);
			return to.split(separator);
		}
	};
}
/**
* Pad strings array so it has integer number of bits
* @__NO_SIDE_EFFECTS__
*/
function padding(bits, chr = "=") {
	anumber$3(bits);
	astr("padding", chr);
	return {
		encode(data) {
			astrArr("padding.encode", data);
			while (data.length * bits % 8) data.push(chr);
			return data;
		},
		decode(input) {
			astrArr("padding.decode", input);
			let end = input.length;
			if (end * bits % 8) throw new Error("padding: invalid, string should have whole number of bytes");
			for (; end > 0 && input[end - 1] === chr; end--) if ((end - 1) * bits % 8 === 0) throw new Error("padding: invalid, string has too much padding");
			return input.slice(0, end);
		}
	};
}
/**
* @__NO_SIDE_EFFECTS__
*/
function normalize(fn) {
	afn(fn);
	return {
		encode: (from) => from,
		decode: (to) => fn(to)
	};
}
const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
const radix2carry = /* @__NO_SIDE_EFFECTS__ */ (from, to) => from + (to - gcd(from, to));
const powers = /* @__PURE__ */ (() => {
	let res = [];
	for (let i = 0; i < 40; i++) res.push(2 ** i);
	return res;
})();
/**
* Implemented with numbers, because BigInt is 5x slower
*/
function convertRadix2(data, from, to, padding) {
	aArr(data);
	if (from <= 0 || from > 32) throw new Error(`convertRadix2: wrong from=${from}`);
	if (to <= 0 || to > 32) throw new Error(`convertRadix2: wrong to=${to}`);
	if (/* @__PURE__ */ radix2carry(from, to) > 32) throw new Error(`convertRadix2: carry overflow from=${from} to=${to} carryBits=${/* @__PURE__ */ radix2carry(from, to)}`);
	let carry = 0;
	let pos = 0;
	const max = powers[from];
	const mask = powers[to] - 1;
	const res = [];
	for (const n of data) {
		anumber$3(n);
		if (n >= max) throw new Error(`convertRadix2: invalid data word=${n} from=${from}`);
		carry = carry << from | n;
		if (pos + from > 32) throw new Error(`convertRadix2: carry overflow pos=${pos} from=${from}`);
		pos += from;
		for (; pos >= to; pos -= to) res.push((carry >> pos - to & mask) >>> 0);
		const pow = powers[pos];
		if (pow === void 0) throw new Error("invalid carry");
		carry &= pow - 1;
	}
	carry = carry << to - pos & mask;
	if (!padding && pos >= from) throw new Error("Excess padding");
	if (!padding && carry > 0) throw new Error(`Non-zero padding: ${carry}`);
	if (padding && pos > 0) res.push(carry >>> 0);
	return res;
}
/**
* If both bases are power of same number (like `2**8 <-> 2**64`),
* there is a linear algorithm. For now we have implementation for power-of-two bases only.
* @__NO_SIDE_EFFECTS__
*/
function radix2(bits, revPadding = false) {
	anumber$3(bits);
	if (bits <= 0 || bits > 32) throw new Error("radix2: bits should be in (0..32]");
	if (/* @__PURE__ */ radix2carry(8, bits) > 32 || /* @__PURE__ */ radix2carry(bits, 8) > 32) throw new Error("radix2: carry overflow");
	return {
		encode: (bytes) => {
			if (!isBytes$3(bytes)) throw new Error("radix2.encode input should be Uint8Array");
			return convertRadix2(Array.from(bytes), 8, bits, !revPadding);
		},
		decode: (digits) => {
			anumArr("radix2.decode", digits);
			return Uint8Array.from(convertRadix2(digits, bits, 8, revPadding));
		}
	};
}
function unsafeWrapper(fn) {
	afn(fn);
	return function(...args) {
		try {
			return fn.apply(null, args);
		} catch (e) {}
	};
}
chain(radix2(4), alphabet("0123456789ABCDEF"), join$1(""));
chain(radix2(5), alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"), padding(5), join$1(""));
chain(radix2(5), alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"), join$1(""));
chain(radix2(5), alphabet("0123456789ABCDEFGHIJKLMNOPQRSTUV"), padding(5), join$1(""));
chain(radix2(5), alphabet("0123456789ABCDEFGHIJKLMNOPQRSTUV"), join$1(""));
chain(radix2(5), alphabet("0123456789ABCDEFGHJKMNPQRSTVWXYZ"), join$1(""), normalize((s) => s.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1")));
const hasBase64Builtin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toBase64 === "function" && typeof Uint8Array.fromBase64 === "function")();
const decodeBase64Builtin = (s, isUrl) => {
	astr("base64", s);
	const re = isUrl ? /^[A-Za-z0-9=_-]+$/ : /^[A-Za-z0-9=+/]+$/;
	const alphabet = isUrl ? "base64url" : "base64";
	if (s.length > 0 && !re.test(s)) throw new Error("invalid base64");
	return Uint8Array.fromBase64(s, {
		alphabet,
		lastChunkHandling: "strict"
	});
};
/**
* base64 from RFC 4648. Padded.
* Use `base64nopad` for unpadded version.
* Also check out `base64url`, `base64urlnopad`.
* Falls back to built-in function, when available.
* @example
* ```js
* base64.encode(Uint8Array.from([0x12, 0xab]));
* // => 'Eqs='
* base64.decode('Eqs=');
* // => Uint8Array.from([0x12, 0xab])
* ```
*/
const base64$1 = hasBase64Builtin ? {
	encode(b) {
		abytes$3(b);
		return b.toBase64();
	},
	decode(s) {
		return decodeBase64Builtin(s, false);
	}
} : chain(radix2(6), alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"), padding(6), join$1(""));
chain(radix2(6), alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"), join$1(""));
hasBase64Builtin || chain(radix2(6), alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"), padding(6), join$1(""));
chain(radix2(6), alphabet("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"), join$1(""));
const BECH_ALPHABET = chain(alphabet("qpzry9x8gf2tvdw0s3jn54khce6mua7l"), join$1(""));
const POLYMOD_GENERATORS = [
	996825010,
	642813549,
	513874426,
	1027748829,
	705979059
];
function bech32Polymod(pre) {
	const b = pre >> 25;
	let chk = (pre & 33554431) << 5;
	for (let i = 0; i < POLYMOD_GENERATORS.length; i++) if ((b >> i & 1) === 1) chk ^= POLYMOD_GENERATORS[i];
	return chk;
}
function bechChecksum(prefix, words, encodingConst = 1) {
	const len = prefix.length;
	let chk = 1;
	for (let i = 0; i < len; i++) {
		const c = prefix.charCodeAt(i);
		if (c < 33 || c > 126) throw new Error(`Invalid prefix (${prefix})`);
		chk = bech32Polymod(chk) ^ c >> 5;
	}
	chk = bech32Polymod(chk);
	for (let i = 0; i < len; i++) chk = bech32Polymod(chk) ^ prefix.charCodeAt(i) & 31;
	for (let v of words) chk = bech32Polymod(chk) ^ v;
	for (let i = 0; i < 6; i++) chk = bech32Polymod(chk);
	chk ^= encodingConst;
	return BECH_ALPHABET.encode(convertRadix2([chk % powers[30]], 30, 5, false));
}
/**
* @__NO_SIDE_EFFECTS__
*/
function genBech32(encoding) {
	const ENCODING_CONST = encoding === "bech32" ? 1 : 734539939;
	const _words = radix2(5);
	const fromWords = _words.decode;
	const toWords = _words.encode;
	const fromWordsUnsafe = unsafeWrapper(fromWords);
	function encode(prefix, words, limit = 90) {
		astr("bech32.encode prefix", prefix);
		if (isBytes$3(words)) words = Array.from(words);
		anumArr("bech32.encode", words);
		const plen = prefix.length;
		if (plen === 0) throw new TypeError(`Invalid prefix length ${plen}`);
		const actualLength = plen + 7 + words.length;
		if (limit !== false && actualLength > limit) throw new TypeError(`Length ${actualLength} exceeds limit ${limit}`);
		const lowered = prefix.toLowerCase();
		const sum = bechChecksum(lowered, words, ENCODING_CONST);
		return `${lowered}1${BECH_ALPHABET.encode(words)}${sum}`;
	}
	function decode(str, limit = 90) {
		astr("bech32.decode input", str);
		const slen = str.length;
		if (slen < 8 || limit !== false && slen > limit) throw new TypeError(`invalid string length: ${slen} (${str}). Expected (8..${limit})`);
		const lowered = str.toLowerCase();
		if (str !== lowered && str !== str.toUpperCase()) throw new Error(`String must be lowercase or uppercase`);
		const sepIndex = lowered.lastIndexOf("1");
		if (sepIndex === 0 || sepIndex === -1) throw new Error(`Letter "1" must be present between prefix and data only`);
		const prefix = lowered.slice(0, sepIndex);
		const data = lowered.slice(sepIndex + 1);
		if (data.length < 6) throw new Error("Data must be at least 6 characters long");
		const words = BECH_ALPHABET.decode(data).slice(0, -6);
		const sum = bechChecksum(prefix, words, ENCODING_CONST);
		if (!data.endsWith(sum)) throw new Error(`Invalid checksum in ${str}: expected "${sum}"`);
		return {
			prefix,
			words
		};
	}
	const decodeUnsafe = unsafeWrapper(decode);
	function decodeToBytes(str) {
		const { prefix, words } = decode(str, false);
		return {
			prefix,
			words,
			bytes: fromWords(words)
		};
	}
	function encodeFromBytes(prefix, bytes) {
		return encode(prefix, toWords(bytes));
	}
	return {
		encode,
		decode,
		encodeFromBytes,
		decodeToBytes,
		decodeUnsafe,
		fromWords,
		fromWordsUnsafe,
		toWords
	};
}
/**
* bech32 from BIP 173. Operates on words.
* For high-level, check out scure-btc-signer:
* https://github.com/paulmillr/scure-btc-signer.
*/
const bech32 = genBech32("bech32");
genBech32("bech32m");
/* @__PURE__ */ (() => typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function")() || chain(radix2(4), alphabet("0123456789abcdef"), join$1(""), normalize((s) => {
	if (typeof s !== "string" || s.length % 2 !== 0) throw new TypeError(`hex.decode: expected string, got ${typeof s} with length ${s.length}`);
	return s.toLowerCase();
}));
//#endregion
//#region node_modules/nostr-tools/lib/esm/nip19.js
init_utils$1();
var utf8Decoder$2 = new TextDecoder("utf-8");
var utf8Encoder$3 = new TextEncoder();
var Bech32MaxSize$1 = 5e3;
function decode$2(code) {
	let { prefix, words } = bech32.decode(code, Bech32MaxSize$1);
	let data = new Uint8Array(bech32.fromWords(words));
	switch (prefix) {
		case "nprofile": {
			let tlv = parseTLV$1(data);
			if (!tlv[0]?.[0]) throw new Error("missing TLV 0 for nprofile");
			if (tlv[0][0].length !== 32) throw new Error("TLV 0 should be 32 bytes");
			return {
				type: "nprofile",
				data: {
					pubkey: bytesToHex$2(tlv[0][0]),
					relays: tlv[1] ? tlv[1].map((d) => utf8Decoder$2.decode(d)) : []
				}
			};
		}
		case "nevent": {
			let tlv = parseTLV$1(data);
			if (!tlv[0]?.[0]) throw new Error("missing TLV 0 for nevent");
			if (tlv[0][0].length !== 32) throw new Error("TLV 0 should be 32 bytes");
			if (tlv[2] && tlv[2][0].length !== 32) throw new Error("TLV 2 should be 32 bytes");
			if (tlv[3] && tlv[3][0].length !== 4) throw new Error("TLV 3 should be 4 bytes");
			return {
				type: "nevent",
				data: {
					id: bytesToHex$2(tlv[0][0]),
					relays: tlv[1] ? tlv[1].map((d) => utf8Decoder$2.decode(d)) : [],
					author: tlv[2]?.[0] ? bytesToHex$2(tlv[2][0]) : void 0,
					kind: tlv[3]?.[0] ? parseInt(bytesToHex$2(tlv[3][0]), 16) : void 0
				}
			};
		}
		case "naddr": {
			let tlv = parseTLV$1(data);
			if (!tlv[0]?.[0]) throw new Error("missing TLV 0 for naddr");
			if (!tlv[2]?.[0]) throw new Error("missing TLV 2 for naddr");
			if (tlv[2][0].length !== 32) throw new Error("TLV 2 should be 32 bytes");
			if (!tlv[3]?.[0]) throw new Error("missing TLV 3 for naddr");
			if (tlv[3][0].length !== 4) throw new Error("TLV 3 should be 4 bytes");
			return {
				type: "naddr",
				data: {
					identifier: utf8Decoder$2.decode(tlv[0][0]),
					pubkey: bytesToHex$2(tlv[2][0]),
					kind: parseInt(bytesToHex$2(tlv[3][0]), 16),
					relays: tlv[1] ? tlv[1].map((d) => utf8Decoder$2.decode(d)) : []
				}
			};
		}
		case "nsec": return {
			type: prefix,
			data
		};
		case "npub":
		case "note": return {
			type: prefix,
			data: bytesToHex$2(data)
		};
		default: throw new Error(`unknown prefix ${prefix}`);
	}
}
function parseTLV$1(data) {
	let result = {};
	let rest = data;
	while (rest.length > 0) {
		let t = rest[0];
		let l = rest[1];
		let v = rest.slice(2, 2 + l);
		rest = rest.slice(2 + l);
		if (v.length < l) throw new Error(`not enough data to read on TLV ${t}`);
		result[t] = result[t] || [];
		result[t].push(v);
	}
	return result;
}
function npubEncode$1(hex) {
	return encodeBytes$1("npub", hexToBytes$2(hex));
}
function encodeBech32$1(prefix, data) {
	let words = bech32.toWords(data);
	return bech32.encode(prefix, words, Bech32MaxSize$1);
}
function encodeBytes$1(prefix, bytes) {
	return encodeBech32$1(prefix, bytes);
}
function naddrEncode$1(addr) {
	let kind = /* @__PURE__ */ new ArrayBuffer(4);
	new DataView(kind).setUint32(0, addr.kind, false);
	return encodeBech32$1("naddr", encodeTLV$1({
		0: [utf8Encoder$3.encode(addr.identifier)],
		1: (addr.relays || []).map((url) => utf8Encoder$3.encode(url)),
		2: [hexToBytes$2(addr.pubkey)],
		3: [new Uint8Array(kind)]
	}));
}
function encodeTLV$1(tlv) {
	let entries = [];
	Object.entries(tlv).reverse().forEach(([t, vs]) => {
		vs.forEach((v) => {
			let entry = new Uint8Array(v.length + 2);
			entry.set([parseInt(t)], 0);
			entry.set([v.length], 1);
			entry.set(v, 2);
			entries.push(entry);
		});
	});
	return concatBytes$2(...entries);
}
//#endregion
//#region node_modules/@noble/hashes/utils.js
/**
* Checks if something is Uint8Array. Be careful: nodejs Buffer will return true.
* @param a - value to test
* @returns `true` when the value is a Uint8Array-compatible view.
* @example
* Check whether a value is a Uint8Array-compatible view.
* ```ts
* isBytes(new Uint8Array([1, 2, 3]));
* ```
*/
function isBytes$2(a) {
	return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
/**
* Asserts something is a non-negative integer.
* @param n - number to validate
* @param title - label included in thrown errors
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Validate a non-negative integer option.
* ```ts
* anumber(32, 'length');
* ```
*/
function anumber$2(n, title = "") {
	if (typeof n !== "number") {
		const prefix = title && `"${title}" `;
		throw new TypeError(`${prefix}expected number, got ${typeof n}`);
	}
	if (!Number.isSafeInteger(n) || n < 0) {
		const prefix = title && `"${title}" `;
		throw new RangeError(`${prefix}expected integer >= 0, got ${n}`);
	}
}
/**
* Asserts something is Uint8Array.
* @param value - value to validate
* @param length - optional exact length constraint
* @param title - label included in thrown errors
* @returns The validated byte array.
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Validate that a value is a byte array.
* ```ts
* abytes(new Uint8Array([1, 2, 3]));
* ```
*/
function abytes$2(value, length, title = "") {
	const bytes = isBytes$2(value);
	const len = value?.length;
	const needsLen = length !== void 0;
	if (!bytes || needsLen && len !== length) {
		const prefix = title && `"${title}" `;
		const ofLen = needsLen ? ` of length ${length}` : "";
		const got = bytes ? `length=${len}` : `type=${typeof value}`;
		const message = prefix + "expected Uint8Array" + ofLen + ", got " + got;
		if (!bytes) throw new TypeError(message);
		throw new RangeError(message);
	}
	return value;
}
/**
* Asserts something is a wrapped hash constructor.
* @param h - hash constructor to validate
* @throws On wrong argument types or invalid hash wrapper shape. {@link TypeError}
* @throws On invalid hash metadata ranges or values. {@link RangeError}
* @throws If the hash metadata allows empty outputs or block sizes. {@link Error}
* @example
* Validate a callable hash wrapper.
* ```ts
* import { ahash } from '@noble/hashes/utils.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* ahash(sha256);
* ```
*/
function ahash(h) {
	if (typeof h !== "function" || typeof h.create !== "function") throw new TypeError("Hash must wrapped by utils.createHasher");
	anumber$2(h.outputLen);
	anumber$2(h.blockLen);
	if (h.outputLen < 1) throw new Error("\"outputLen\" must be >= 1");
	if (h.blockLen < 1) throw new Error("\"blockLen\" must be >= 1");
}
/**
* Asserts a hash instance has not been destroyed or finished.
* @param instance - hash instance to validate
* @param checkFinished - whether to reject finalized instances
* @throws If the hash instance has already been destroyed or finalized. {@link Error}
* @example
* Validate that a hash instance is still usable.
* ```ts
* import { aexists } from '@noble/hashes/utils.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* const hash = sha256.create();
* aexists(hash);
* ```
*/
function aexists$1(instance, checkFinished = true) {
	if (instance.destroyed) throw new Error("Hash instance has been destroyed");
	if (checkFinished && instance.finished) throw new Error("Hash#digest() has already been called");
}
/**
* Asserts output is a sufficiently-sized byte array.
* @param out - destination buffer
* @param instance - hash instance providing output length
* Oversized buffers are allowed; downstream code only promises to fill the first `outputLen` bytes.
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Validate a caller-provided digest buffer.
* ```ts
* import { aoutput } from '@noble/hashes/utils.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* const hash = sha256.create();
* aoutput(new Uint8Array(hash.outputLen), hash);
* ```
*/
function aoutput$1(out, instance) {
	abytes$2(out, void 0, "digestInto() output");
	const min = instance.outputLen;
	if (out.length < min) throw new RangeError("\"digestInto() output\" expected to be of length >=" + min);
}
/**
* Zeroizes typed arrays in place. Warning: JS provides no guarantees.
* @param arrays - arrays to overwrite with zeros
* @example
* Zeroize sensitive buffers in place.
* ```ts
* clean(new Uint8Array([1, 2, 3]));
* ```
*/
function clean$1(...arrays) {
	for (let i = 0; i < arrays.length; i++) arrays[i].fill(0);
}
/**
* Creates a DataView for byte-level manipulation.
* @param arr - source typed array
* @returns DataView over the same buffer region.
* @example
* Create a DataView over an existing buffer.
* ```ts
* createView(new Uint8Array(4));
* ```
*/
function createView$1(arr) {
	return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
/**
* Rotate-right operation for uint32 values.
* @param word - source word
* @param shift - shift amount in bits
* @returns Rotated word.
* @example
* Rotate a 32-bit word to the right.
* ```ts
* rotr(0x12345678, 8);
* ```
*/
function rotr(word, shift) {
	return word << 32 - shift | word >>> shift;
}
const hasHexBuiltin = /* @__PURE__ */ (() => typeof Uint8Array.from([]).toHex === "function" && typeof Uint8Array.fromHex === "function")();
const hexes = /* @__PURE__ */ Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));
/**
* Convert byte array to hex string.
* Uses the built-in function when available and assumes it matches the tested
* fallback semantics.
* @param bytes - bytes to encode
* @returns Lowercase hexadecimal string.
* @throws On wrong argument types. {@link TypeError}
* @example
* Convert bytes to lowercase hexadecimal.
* ```ts
* bytesToHex(Uint8Array.from([0xca, 0xfe, 0x01, 0x23])); // 'cafe0123'
* ```
*/
function bytesToHex$1(bytes) {
	abytes$2(bytes);
	if (hasHexBuiltin) return bytes.toHex();
	let hex = "";
	for (let i = 0; i < bytes.length; i++) hex += hexes[bytes[i]];
	return hex;
}
const asciis = {
	_0: 48,
	_9: 57,
	A: 65,
	F: 70,
	a: 97,
	f: 102
};
function asciiToBase16(ch) {
	if (ch >= asciis._0 && ch <= asciis._9) return ch - asciis._0;
	if (ch >= asciis.A && ch <= asciis.F) return ch - (asciis.A - 10);
	if (ch >= asciis.a && ch <= asciis.f) return ch - (asciis.a - 10);
}
/**
* Convert hex string to byte array. Uses built-in function, when available.
* @param hex - hexadecimal string to decode
* @returns Decoded bytes.
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Decode lowercase hexadecimal into bytes.
* ```ts
* hexToBytes('cafe0123'); // Uint8Array.from([0xca, 0xfe, 0x01, 0x23])
* ```
*/
function hexToBytes$1(hex) {
	if (typeof hex !== "string") throw new TypeError("hex string expected, got " + typeof hex);
	if (hasHexBuiltin) try {
		return Uint8Array.fromHex(hex);
	} catch (error) {
		if (error instanceof SyntaxError) throw new RangeError(error.message);
		throw error;
	}
	const hl = hex.length;
	const al = hl / 2;
	if (hl % 2) throw new RangeError("hex string expected, got unpadded hex of length " + hl);
	const array = new Uint8Array(al);
	for (let ai = 0, hi = 0; ai < al; ai++, hi += 2) {
		const n1 = asciiToBase16(hex.charCodeAt(hi));
		const n2 = asciiToBase16(hex.charCodeAt(hi + 1));
		if (n1 === void 0 || n2 === void 0) {
			const char = hex[hi] + hex[hi + 1];
			throw new RangeError("hex string expected, got non-hex character \"" + char + "\" at index " + hi);
		}
		array[ai] = n1 * 16 + n2;
	}
	return array;
}
/**
* Copies several Uint8Arrays into one.
* @param arrays - arrays to concatenate
* @returns Concatenated byte array.
* @throws On wrong argument types. {@link TypeError}
* @example
* Concatenate multiple byte arrays.
* ```ts
* concatBytes(new Uint8Array([1]), new Uint8Array([2]));
* ```
*/
function concatBytes$1(...arrays) {
	let sum = 0;
	for (let i = 0; i < arrays.length; i++) {
		const a = arrays[i];
		abytes$2(a);
		sum += a.length;
	}
	const res = new Uint8Array(sum);
	for (let i = 0, pad = 0; i < arrays.length; i++) {
		const a = arrays[i];
		res.set(a, pad);
		pad += a.length;
	}
	return res;
}
/**
* Creates a callable hash function from a stateful class constructor.
* @param hashCons - hash constructor or factory
* @param info - optional metadata such as DER OID
* @returns Frozen callable hash wrapper with `.create()`.
*   Wrapper construction eagerly calls `hashCons(undefined)` once to read
*   `outputLen` / `blockLen`, so constructor side effects happen at module
*   init time.
* @example
* Wrap a stateful hash constructor into a callable helper.
* ```ts
* import { createHasher } from '@noble/hashes/utils.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* const wrapped = createHasher(sha256.create, { oid: sha256.oid });
* wrapped(new Uint8Array([1]));
* ```
*/
function createHasher(hashCons, info = {}) {
	const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
	const tmp = hashCons(void 0);
	hashC.outputLen = tmp.outputLen;
	hashC.blockLen = tmp.blockLen;
	hashC.canXOF = tmp.canXOF;
	hashC.create = (opts) => hashCons(opts);
	Object.assign(hashC, info);
	return Object.freeze(hashC);
}
/**
* Cryptographically secure PRNG backed by `crypto.getRandomValues`.
* @param bytesLength - number of random bytes to generate
* @returns Random bytes.
* The platform `getRandomValues()` implementation still defines any
* single-call length cap, and this helper rejects oversize requests
* with a stable library `RangeError` instead of host-specific errors.
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong argument ranges or values. {@link RangeError}
* @throws If the current runtime does not provide `crypto.getRandomValues`. {@link Error}
* @example
* Generate a fresh random key or nonce.
* ```ts
* const key = randomBytes(16);
* ```
*/
function randomBytes$1(bytesLength = 32) {
	anumber$2(bytesLength, "bytesLength");
	const cr = typeof globalThis === "object" ? globalThis.crypto : null;
	if (typeof cr?.getRandomValues !== "function") throw new Error("crypto.getRandomValues must be defined");
	if (bytesLength > 65536) throw new RangeError(`"bytesLength" expected <= 65536, got ${bytesLength}`);
	return cr.getRandomValues(new Uint8Array(bytesLength));
}
/**
* Creates OID metadata for NIST hashes with prefix `06 09 60 86 48 01 65 03 04 02`.
* @param suffix - final OID byte for the selected hash.
*   The helper accepts any byte even though only the documented NIST hash
*   suffixes are meaningful downstream.
* @returns Object containing the DER-encoded OID.
* @example
* Build OID metadata for a NIST hash.
* ```ts
* oidNist(0x01);
* ```
*/
const oidNist = (suffix) => ({ oid: Uint8Array.from([
	6,
	9,
	96,
	134,
	72,
	1,
	101,
	3,
	4,
	2,
	suffix
]) });
//#endregion
//#region node_modules/@noble/hashes/_md.js
/**
* Internal Merkle-Damgard hash utils.
* @module
*/
/**
* Shared 32-bit conditional boolean primitive reused by SHA-256, SHA-1, and MD5 `F`.
* Returns bits from `b` when `a` is set, otherwise from `c`.
* The XOR form is equivalent to MD5's `F(X,Y,Z) = XY v not(X)Z` because the masked terms never
* set the same bit.
* @param a - selector word
* @param b - word chosen when selector bit is set
* @param c - word chosen when selector bit is clear
* @returns Mixed 32-bit word.
* @example
* Combine three words with the shared 32-bit choice primitive.
* ```ts
* Chi(0xffffffff, 0x12345678, 0x87654321);
* ```
*/
function Chi(a, b, c) {
	return a & b ^ ~a & c;
}
/**
* Shared 32-bit majority primitive reused by SHA-256 and SHA-1.
* Returns bits shared by at least two inputs.
* @param a - first input word
* @param b - second input word
* @param c - third input word
* @returns Mixed 32-bit word.
* @example
* Combine three words with the shared 32-bit majority primitive.
* ```ts
* Maj(0xffffffff, 0x12345678, 0x87654321);
* ```
*/
function Maj(a, b, c) {
	return a & b ^ a & c ^ b & c;
}
/**
* Merkle-Damgard hash construction base class.
* Could be used to create MD5, RIPEMD, SHA1, SHA2.
* Accepts only byte-aligned `Uint8Array` input, even when the underlying spec describes bit
* strings with partial-byte tails.
* @param blockLen - internal block size in bytes
* @param outputLen - digest size in bytes
* @param padOffset - trailing length field size in bytes
* @param isLE - whether length and state words are encoded in little-endian
* @example
* Use a concrete subclass to get the shared Merkle-Damgard update/digest flow.
* ```ts
* import { _SHA1 } from '@noble/hashes/legacy.js';
* const hash = new _SHA1();
* hash.update(new Uint8Array([97, 98, 99]));
* hash.digest();
* ```
*/
var HashMD = class {
	blockLen;
	outputLen;
	canXOF = false;
	padOffset;
	isLE;
	buffer;
	view;
	finished = false;
	length = 0;
	pos = 0;
	destroyed = false;
	constructor(blockLen, outputLen, padOffset, isLE) {
		this.blockLen = blockLen;
		this.outputLen = outputLen;
		this.padOffset = padOffset;
		this.isLE = isLE;
		this.buffer = new Uint8Array(blockLen);
		this.view = createView$1(this.buffer);
	}
	update(data) {
		aexists$1(this);
		abytes$2(data);
		const { view, buffer, blockLen } = this;
		const len = data.length;
		for (let pos = 0; pos < len;) {
			const take = Math.min(blockLen - this.pos, len - pos);
			if (take === blockLen) {
				const dataView = createView$1(data);
				for (; blockLen <= len - pos; pos += blockLen) this.process(dataView, pos);
				continue;
			}
			buffer.set(data.subarray(pos, pos + take), this.pos);
			this.pos += take;
			pos += take;
			if (this.pos === blockLen) {
				this.process(view, 0);
				this.pos = 0;
			}
		}
		this.length += data.length;
		this.roundClean();
		return this;
	}
	digestInto(out) {
		aexists$1(this);
		aoutput$1(out, this);
		this.finished = true;
		const { buffer, view, blockLen, isLE } = this;
		let { pos } = this;
		buffer[pos++] = 128;
		clean$1(this.buffer.subarray(pos));
		if (this.padOffset > blockLen - pos) {
			this.process(view, 0);
			pos = 0;
		}
		for (let i = pos; i < blockLen; i++) buffer[i] = 0;
		view.setBigUint64(blockLen - 8, BigInt(this.length * 8), isLE);
		this.process(view, 0);
		const oview = createView$1(out);
		const len = this.outputLen;
		if (len % 4) throw new Error("_sha2: outputLen must be aligned to 32bit");
		const outLen = len / 4;
		const state = this.get();
		if (outLen > state.length) throw new Error("_sha2: outputLen bigger than state");
		for (let i = 0; i < outLen; i++) oview.setUint32(4 * i, state[i], isLE);
	}
	digest() {
		const { buffer, outputLen } = this;
		this.digestInto(buffer);
		const res = buffer.slice(0, outputLen);
		this.destroy();
		return res;
	}
	_cloneInto(to) {
		to ||= new this.constructor();
		to.set(...this.get());
		const { blockLen, buffer, length, finished, destroyed, pos } = this;
		to.destroyed = destroyed;
		to.finished = finished;
		to.length = length;
		to.pos = pos;
		if (length % blockLen) to.buffer.set(buffer);
		return to;
	}
	clone() {
		return this._cloneInto();
	}
};
/**
* Initial SHA-2 state: fractional parts of square roots of first 16 primes 2..53.
* Check out `test/misc/sha2-gen-iv.js` for recomputation guide.
*/
/** Initial SHA256 state from RFC 6234 §6.1: the first 32 bits of the fractional parts of the
* square roots of the first eight prime numbers. Exported as a shared table; callers must treat
* it as read-only because constructors copy words from it by index. */
const SHA256_IV = /* @__PURE__ */ Uint32Array.from([
	1779033703,
	3144134277,
	1013904242,
	2773480762,
	1359893119,
	2600822924,
	528734635,
	1541459225
]);
//#endregion
//#region node_modules/@noble/hashes/sha2.js
/**
* SHA2 hash function. A.k.a. sha256, sha384, sha512, sha512_224, sha512_256.
* SHA256 is the fastest hash implementable in JS, even faster than Blake3.
* Check out {@link https://www.rfc-editor.org/rfc/rfc4634 | RFC 4634} and
* {@link https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf | FIPS 180-4}.
* @module
*/
/**
* SHA-224 / SHA-256 round constants from RFC 6234 §5.1: the first 32 bits
* of the cube roots of the first 64 primes (2..311).
*/
const SHA256_K = /* @__PURE__ */ Uint32Array.from([
	1116352408,
	1899447441,
	3049323471,
	3921009573,
	961987163,
	1508970993,
	2453635748,
	2870763221,
	3624381080,
	310598401,
	607225278,
	1426881987,
	1925078388,
	2162078206,
	2614888103,
	3248222580,
	3835390401,
	4022224774,
	264347078,
	604807628,
	770255983,
	1249150122,
	1555081692,
	1996064986,
	2554220882,
	2821834349,
	2952996808,
	3210313671,
	3336571891,
	3584528711,
	113926993,
	338241895,
	666307205,
	773529912,
	1294757372,
	1396182291,
	1695183700,
	1986661051,
	2177026350,
	2456956037,
	2730485921,
	2820302411,
	3259730800,
	3345764771,
	3516065817,
	3600352804,
	4094571909,
	275423344,
	430227734,
	506948616,
	659060556,
	883997877,
	958139571,
	1322822218,
	1537002063,
	1747873779,
	1955562222,
	2024104815,
	2227730452,
	2361852424,
	2428436474,
	2756734187,
	3204031479,
	3329325298
]);
/** Reusable SHA-224 / SHA-256 message schedule buffer `W_t` from RFC 6234 §6.2 step 1. */
const SHA256_W = /* @__PURE__ */ new Uint32Array(64);
/** Internal SHA-224 / SHA-256 compression engine from RFC 6234 §6.2. */
var SHA2_32B = class extends HashMD {
	constructor(outputLen) {
		super(64, outputLen, 8, false);
	}
	get() {
		const { A, B, C, D, E, F, G, H } = this;
		return [
			A,
			B,
			C,
			D,
			E,
			F,
			G,
			H
		];
	}
	set(A, B, C, D, E, F, G, H) {
		this.A = A | 0;
		this.B = B | 0;
		this.C = C | 0;
		this.D = D | 0;
		this.E = E | 0;
		this.F = F | 0;
		this.G = G | 0;
		this.H = H | 0;
	}
	process(view, offset) {
		for (let i = 0; i < 16; i++, offset += 4) SHA256_W[i] = view.getUint32(offset, false);
		for (let i = 16; i < 64; i++) {
			const W15 = SHA256_W[i - 15];
			const W2 = SHA256_W[i - 2];
			const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
			SHA256_W[i] = (rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10) + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
		}
		let { A, B, C, D, E, F, G, H } = this;
		for (let i = 0; i < 64; i++) {
			const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
			const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
			const T2 = (rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22)) + Maj(A, B, C) | 0;
			H = G;
			G = F;
			F = E;
			E = D + T1 | 0;
			D = C;
			C = B;
			B = A;
			A = T1 + T2 | 0;
		}
		A = A + this.A | 0;
		B = B + this.B | 0;
		C = C + this.C | 0;
		D = D + this.D | 0;
		E = E + this.E | 0;
		F = F + this.F | 0;
		G = G + this.G | 0;
		H = H + this.H | 0;
		this.set(A, B, C, D, E, F, G, H);
	}
	roundClean() {
		clean$1(SHA256_W);
	}
	destroy() {
		this.destroyed = true;
		this.set(0, 0, 0, 0, 0, 0, 0, 0);
		clean$1(this.buffer);
	}
};
/** Internal SHA-256 hash class grounded in RFC 6234 §6.2. */
var _SHA256 = class extends SHA2_32B {
	A = SHA256_IV[0] | 0;
	B = SHA256_IV[1] | 0;
	C = SHA256_IV[2] | 0;
	D = SHA256_IV[3] | 0;
	E = SHA256_IV[4] | 0;
	F = SHA256_IV[5] | 0;
	G = SHA256_IV[6] | 0;
	H = SHA256_IV[7] | 0;
	constructor() {
		super(32);
	}
};
/**
* SHA2-256 hash function from RFC 4634. In JS it's the fastest: even faster than Blake3. Some info:
*
* - Trying 2^128 hashes would get 50% chance of collision, using birthday attack.
* - BTC network is doing 2^70 hashes/sec (2^95 hashes/year) as per 2025.
* - Each sha256 hash is executing 2^18 bit operations.
* - Good 2024 ASICs can do 200Th/sec with 3500 watts of power, corresponding to 2^36 hashes/joule.
* @param msg - message bytes to hash
* @returns Digest bytes.
* @example
* Hash a message with SHA2-256.
* ```ts
* sha256(new Uint8Array([97, 98, 99]));
* ```
*/
const sha256 = /* @__PURE__ */ createHasher(() => new _SHA256(), /* @__PURE__ */ oidNist(1));
//#endregion
//#region node_modules/@noble/curves/utils.js
/**
* Hex, bytes and number utilities.
* @module
*/
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
/**
* Validates that a value is a byte array.
* @param value - Value to validate.
* @param length - Optional exact byte length.
* @param title - Optional field name.
* @returns Original byte array.
* @example
* Reject non-byte input before passing data into curve code.
*
* ```ts
* abytes(new Uint8Array(1));
* ```
*/
const abytes$1 = (value, length, title) => abytes$2(value, length, title);
/**
* Validates that a value is a non-negative safe integer.
* @param n - Value to validate.
* @param title - Optional field name.
* @example
* Validate a numeric length before allocating buffers.
*
* ```ts
* anumber(1);
* ```
*/
const anumber$1 = anumber$2;
/**
* Encodes bytes as lowercase hex.
* @param bytes - Bytes to encode.
* @returns Lowercase hex string.
* @example
* Serialize bytes as hex for logging or fixtures.
*
* ```ts
* bytesToHex(Uint8Array.of(1, 2, 3));
* ```
*/
const bytesToHex = bytesToHex$1;
/**
* Concatenates byte arrays.
* @param arrays - Byte arrays to join.
* @returns Concatenated bytes.
* @example
* Join domain-separated chunks into one buffer.
*
* ```ts
* concatBytes(Uint8Array.of(1), Uint8Array.of(2));
* ```
*/
const concatBytes = (...arrays) => concatBytes$1(...arrays);
/**
* Decodes lowercase or uppercase hex into bytes.
* @param hex - Hex string to decode.
* @returns Decoded bytes.
* @example
* Parse fixture hex into bytes before hashing.
*
* ```ts
* hexToBytes('0102');
* ```
*/
const hexToBytes = (hex) => hexToBytes$1(hex);
/**
* Checks whether a value is a Uint8Array.
* @param a - Value to inspect.
* @returns `true` when `a` is a Uint8Array.
* @example
* Branch on byte input before decoding it.
*
* ```ts
* isBytes(new Uint8Array(1));
* ```
*/
const isBytes$1 = isBytes$2;
/**
* Reads random bytes from the platform CSPRNG.
* @param bytesLength - Number of random bytes to read.
* @returns Fresh random bytes.
* @example
* Generate a random seed for a keypair.
*
* ```ts
* randomBytes(2);
* ```
*/
const randomBytes = (bytesLength) => randomBytes$1(bytesLength);
const _0n$4 = /* @__PURE__ */ BigInt(0);
const _1n$3 = /* @__PURE__ */ BigInt(1);
/**
* Validates that a flag is boolean.
* @param value - Value to validate.
* @param title - Optional field name.
* @returns Original value.
* @throws On wrong argument types. {@link TypeError}
* @example
* Reject non-boolean option flags early.
*
* ```ts
* abool(true);
* ```
*/
function abool$1(value, title = "") {
	if (typeof value !== "boolean") {
		const prefix = title && `"${title}" `;
		throw new TypeError(prefix + "expected boolean, got type=" + typeof value);
	}
	return value;
}
/**
* Validates that a value is a non-negative bigint or safe integer.
* @param n - Value to validate.
* @returns The same validated value.
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Validate one integer-like value before serializing it.
*
* ```ts
* abignumber(1n);
* ```
*/
function abignumber(n) {
	if (typeof n === "bigint") {
		if (!isPosBig(n)) throw new RangeError("positive bigint expected, got " + n);
	} else anumber$1(n);
	return n;
}
/**
* Validates that a value is a safe integer.
* @param value - Integer to validate.
* @param title - Optional field name.
* @throws On wrong argument types. {@link TypeError}
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Validate a window size before scalar arithmetic uses it.
*
* ```ts
* asafenumber(1);
* ```
*/
function asafenumber(value, title = "") {
	if (typeof value !== "number") {
		const prefix = title && `"${title}" `;
		throw new TypeError(prefix + "expected number, got type=" + typeof value);
	}
	if (!Number.isSafeInteger(value)) {
		const prefix = title && `"${title}" `;
		throw new RangeError(prefix + "expected safe integer, got " + value);
	}
}
/**
* Encodes a bigint into even-length big-endian hex.
* The historical "unpadded" name only means "no fixed-width field padding"; odd-length hex still
* gets one leading zero nibble so the result always represents whole bytes.
* @param num - Number to encode.
* @returns Big-endian hex string.
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Encode a scalar into hex without a `0x` prefix.
*
* ```ts
* numberToHexUnpadded(255n);
* ```
*/
function numberToHexUnpadded(num) {
	const hex = abignumber(num).toString(16);
	return hex.length & 1 ? "0" + hex : hex;
}
/**
* Parses a big-endian hex string into bigint.
* Accepts odd-length hex through the native `BigInt('0x' + hex)` parser and currently surfaces the
* same native `SyntaxError` for malformed hex instead of wrapping it in a library-specific error.
* @param hex - Hex string without `0x`.
* @returns Parsed bigint value.
* @throws On wrong argument types. {@link TypeError}
* @example
* Parse a scalar from fixture hex.
*
* ```ts
* hexToNumber('ff');
* ```
*/
function hexToNumber(hex) {
	if (typeof hex !== "string") throw new TypeError("hex string expected, got " + typeof hex);
	return hex === "" ? _0n$4 : BigInt("0x" + hex);
}
/**
* Parses big-endian bytes into bigint.
* @param bytes - Bytes in big-endian order.
* @returns Parsed bigint value.
* @throws On wrong argument types. {@link TypeError}
* @example
* Read a scalar encoded in network byte order.
*
* ```ts
* bytesToNumberBE(Uint8Array.of(1, 0));
* ```
*/
function bytesToNumberBE(bytes) {
	return hexToNumber(bytesToHex$1(bytes));
}
/**
* Parses little-endian bytes into bigint.
* @param bytes - Bytes in little-endian order.
* @returns Parsed bigint value.
* @throws On wrong argument types. {@link TypeError}
* @example
* Read a scalar encoded in little-endian form.
*
* ```ts
* bytesToNumberLE(Uint8Array.of(1, 0));
* ```
*/
function bytesToNumberLE(bytes) {
	return hexToNumber(bytesToHex$1(copyBytes$1(abytes$2(bytes)).reverse()));
}
/**
* Encodes a bigint into fixed-length big-endian bytes.
* @param n - Number to encode.
* @param len - Output length in bytes. Must be greater than zero.
* @returns Big-endian byte array.
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Serialize a scalar into a 32-byte field element.
*
* ```ts
* numberToBytesBE(255n, 2);
* ```
*/
function numberToBytesBE(n, len) {
	anumber$2(len);
	if (len === 0) throw new RangeError("zero length");
	n = abignumber(n);
	const hex = n.toString(16);
	if (hex.length > len * 2) throw new RangeError("number too large");
	return hexToBytes$1(hex.padStart(len * 2, "0"));
}
/**
* Encodes a bigint into fixed-length little-endian bytes.
* @param n - Number to encode.
* @param len - Output length in bytes.
* @returns Little-endian byte array.
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Serialize a scalar for little-endian protocols.
*
* ```ts
* numberToBytesLE(255n, 2);
* ```
*/
function numberToBytesLE(n, len) {
	return numberToBytesBE(n, len).reverse();
}
/**
* Copies Uint8Array. We can't use u8a.slice(), because u8a can be Buffer,
* and Buffer#slice creates mutable copy. Never use Buffers!
* @param bytes - Bytes to copy.
* @returns Detached copy.
* @example
* Make an isolated copy before mutating serialized bytes.
*
* ```ts
* copyBytes(Uint8Array.of(1, 2, 3));
* ```
*/
function copyBytes$1(bytes) {
	return Uint8Array.from(abytes$1(bytes));
}
/**
* Decodes 7-bit ASCII string to Uint8Array, throws on non-ascii symbols
* Should be safe to use for things expected to be ASCII.
* Returns exact same result as `TextEncoder` for ASCII or throws.
* @param ascii - ASCII input text.
* @returns Encoded bytes.
* @throws On wrong argument types. {@link TypeError}
* @example
* Encode an ASCII domain-separation tag.
*
* ```ts
* asciiToBytes('ABC');
* ```
*/
function asciiToBytes(ascii) {
	if (typeof ascii !== "string") throw new TypeError("ascii string expected, got " + typeof ascii);
	return Uint8Array.from(ascii, (c, i) => {
		const charCode = c.charCodeAt(0);
		if (c.length !== 1 || charCode > 127) throw new RangeError(`string contains non-ASCII character "${ascii[i]}" with code ${charCode} at position ${i}`);
		return charCode;
	});
}
const isPosBig = (n) => typeof n === "bigint" && _0n$4 <= n;
/**
* Checks whether a bigint lies inside a half-open range.
* @param n - Candidate value.
* @param min - Inclusive lower bound.
* @param max - Exclusive upper bound.
* @returns `true` when the value is inside the range.
* @example
* Check whether a candidate scalar fits the field order.
*
* ```ts
* inRange(2n, 1n, 3n);
* ```
*/
function inRange(n, min, max) {
	return isPosBig(n) && isPosBig(min) && isPosBig(max) && min <= n && n < max;
}
/**
* Asserts `min <= n < max`. NOTE: upper bound is exclusive.
* @param title - Value label for error messages.
* @param n - Candidate value.
* @param min - Inclusive lower bound.
* @param max - Exclusive upper bound.
* Wrong-type inputs are not separated from out-of-range values here: they still flow through the
* shared `RangeError` path because this is only a throwing wrapper around `inRange(...)`.
* @throws On wrong argument ranges or values. {@link RangeError}
* @example
* Assert that a bigint stays within one half-open range.
*
* ```ts
* aInRange('x', 2n, 1n, 256n);
* ```
*/
function aInRange(title, n, min, max) {
	if (!inRange(n, min, max)) throw new RangeError("expected valid " + title + ": " + min + " <= n < " + max + ", got " + n);
}
/**
* Calculates amount of bits in a bigint.
* Same as `n.toString(2).length`
* TODO: merge with nLength in modular
* @param n - Value to inspect.
* @returns Bit length.
* @throws If the value is negative. {@link Error}
* @example
* Measure the bit length of a scalar before serialization.
*
* ```ts
* bitLen(8n);
* ```
*/
function bitLen(n) {
	if (n < _0n$4) throw new Error("expected non-negative bigint, got " + n);
	let len;
	for (len = 0; n > _0n$4; n >>= _1n$3, len += 1);
	return len;
}
/**
* Calculate mask for N bits. Not using ** operator with bigints because of old engines.
* Same as BigInt(`0b${Array(i).fill('1').join('')}`)
* @param n - Number of bits. Negative widths are currently passed through to raw bigint shift
*   semantics and therefore produce `-1n`.
* @returns Bitmask value.
* @example
* Calculate mask for N bits.
*
* ```ts
* bitMask(4);
* ```
*/
const bitMask = (n) => (_1n$3 << BigInt(n)) - _1n$3;
/**
* Minimal HMAC-DRBG from NIST 800-90 for RFC6979 sigs.
* @param hashLen - Hash output size in bytes. Callers are expected to pass a positive length; `0`
*   is not rejected here and would make the internal generate loop non-progressing.
* @param qByteLen - Requested output size in bytes. Callers are expected to pass a positive length.
* @param hmacFn - HMAC implementation.
* @returns Function that will call DRBG until the predicate returns anything
*   other than `undefined`.
* @throws On wrong argument types. {@link TypeError}
* @example
* Build a deterministic nonce generator for RFC6979-style signing.
*
* ```ts
* import { createHmacDrbg } from '@noble/curves/utils.js';
* import { hmac } from '@noble/hashes/hmac.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* const drbg = createHmacDrbg(32, 32, (key, msg) => hmac(sha256, key, msg));
* const seed = new Uint8Array(32);
* drbg(seed, (bytes) => bytes);
* ```
*/
function createHmacDrbg(hashLen, qByteLen, hmacFn) {
	anumber$2(hashLen, "hashLen");
	anumber$2(qByteLen, "qByteLen");
	if (typeof hmacFn !== "function") throw new TypeError("hmacFn must be a function");
	const u8n = (len) => new Uint8Array(len);
	const NULL = Uint8Array.of();
	const byte0 = Uint8Array.of(0);
	const byte1 = Uint8Array.of(1);
	const _maxDrbgIters = 1e3;
	let v = u8n(hashLen);
	let k = u8n(hashLen);
	let i = 0;
	const reset = () => {
		v.fill(1);
		k.fill(0);
		i = 0;
	};
	const h = (...msgs) => hmacFn(k, concatBytes(v, ...msgs));
	const reseed = (seed = NULL) => {
		k = h(byte0, seed);
		v = h();
		if (seed.length === 0) return;
		k = h(byte1, seed);
		v = h();
	};
	const gen = () => {
		if (i++ >= _maxDrbgIters) throw new Error("drbg: tried max amount of iterations");
		let len = 0;
		const out = [];
		while (len < qByteLen) {
			v = h();
			const sl = v.slice();
			out.push(sl);
			len += v.length;
		}
		return concatBytes(...out);
	};
	const genUntil = (seed, pred) => {
		reset();
		reseed(seed);
		let res = void 0;
		while ((res = pred(gen())) === void 0) reseed();
		reset();
		return res;
	};
	return genUntil;
}
/**
* Validates declared required and optional field types on a plain object.
* Extra keys are intentionally ignored because many callers validate only the subset they use from
* richer option bags or runtime objects.
* @param object - Object to validate.
* @param fields - Required field types.
* @param optFields - Optional field types.
* @throws On wrong argument types. {@link TypeError}
* @example
* Check user options before building a curve helper.
*
* ```ts
* validateObject({ flag: true }, { flag: 'boolean' });
* ```
*/
function validateObject(object, fields = {}, optFields = {}) {
	if (Object.prototype.toString.call(object) !== "[object Object]") throw new TypeError("expected valid options object");
	function checkField(fieldName, expectedType, isOpt) {
		if (!isOpt && expectedType !== "function" && !Object.hasOwn(object, fieldName)) throw new TypeError(`param "${fieldName}" is invalid: expected own property`);
		const val = object[fieldName];
		if (isOpt && val === void 0) return;
		const current = typeof val;
		if (current !== expectedType || val === null) throw new TypeError(`param "${fieldName}" is invalid: expected ${expectedType}, got ${current}`);
	}
	const iter = (f, isOpt) => Object.entries(f).forEach(([k, v]) => checkField(k, v, isOpt));
	iter(fields, false);
	iter(optFields, true);
}
//#endregion
//#region node_modules/@noble/curves/abstract/modular.js
/**
* Utils for modular division and fields.
* Field over 11 is a finite (Galois) field is integer number operations `mod 11`.
* There is no division: it is replaced by modular multiplicative inverse.
* @module
*/
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const _0n$3 = /* @__PURE__ */ BigInt(0), _1n$2 = /* @__PURE__ */ BigInt(1), _2n$2 = /* @__PURE__ */ BigInt(2);
const _3n$1 = /* @__PURE__ */ BigInt(3), _4n$1 = /* @__PURE__ */ BigInt(4), _5n = /* @__PURE__ */ BigInt(5);
const _7n = /* @__PURE__ */ BigInt(7), _8n = /* @__PURE__ */ BigInt(8), _9n = /* @__PURE__ */ BigInt(9);
const _16n = /* @__PURE__ */ BigInt(16);
/**
* @param a - Dividend value.
* @param b - Positive modulus.
* @returns Reduced value in `[0, b)` only when `b` is positive.
* @throws If the modulus is not positive. {@link Error}
* @example
* Normalize a bigint into one field residue.
*
* ```ts
* mod(-1n, 5n);
* ```
*/
function mod(a, b) {
	if (b <= _0n$3) throw new Error("mod: expected positive modulus, got " + b);
	const result = a % b;
	return result >= _0n$3 ? result : b + result;
}
/**
* Does `x^(2^power)` mod p. `pow2(30, 4)` == `30^(2^4)`.
* Low-level helper: callers that need canonical residues must pass a valid `x` for the chosen
* modulus; the `power===0` fast path intentionally returns the input unchanged.
* @param x - Base value.
* @param power - Number of squarings.
* @param modulo - Reduction modulus.
* @returns Repeated-squaring result.
* @throws If the exponent is negative. {@link Error}
* @example
* Apply repeated squaring inside one field.
*
* ```ts
* pow2(3n, 2n, 11n);
* ```
*/
function pow2(x, power, modulo) {
	if (power < _0n$3) throw new Error("pow2: expected non-negative exponent, got " + power);
	let res = x;
	while (power-- > _0n$3) {
		res *= res;
		res %= modulo;
	}
	return res;
}
/**
* Inverses number over modulo.
* Implemented using the {@link https://brilliant.org/wiki/extended-euclidean-algorithm/ | extended Euclidean algorithm}.
* @param number - Value to invert.
* @param modulo - Positive modulus.
* @returns Multiplicative inverse.
* @throws If the modulus is invalid or the inverse does not exist. {@link Error}
* @example
* Compute one modular inverse with the extended Euclidean algorithm.
*
* ```ts
* invert(3n, 11n);
* ```
*/
function invert(number, modulo) {
	if (number === _0n$3) throw new Error("invert: expected non-zero number");
	if (modulo <= _0n$3) throw new Error("invert: expected positive modulus, got " + modulo);
	let a = mod(number, modulo);
	let b = modulo;
	let x = _0n$3, y = _1n$2, u = _1n$2, v = _0n$3;
	while (a !== _0n$3) {
		const q = b / a;
		const r = b - a * q;
		const m = x - u * q;
		const n = y - v * q;
		b = a, a = r, x = u, y = v, u = m, v = n;
	}
	if (b !== _1n$2) throw new Error("invert: does not exist");
	return mod(x, modulo);
}
function assertIsSquare(Fp, root, n) {
	const F = Fp;
	if (!F.eql(F.sqr(root), n)) throw new Error("Cannot find square root");
}
function sqrt3mod4(Fp, n) {
	const F = Fp;
	const p1div4 = (F.ORDER + _1n$2) / _4n$1;
	const root = F.pow(n, p1div4);
	assertIsSquare(F, root, n);
	return root;
}
function sqrt5mod8(Fp, n) {
	const F = Fp;
	const p5div8 = (F.ORDER - _5n) / _8n;
	const n2 = F.mul(n, _2n$2);
	const v = F.pow(n2, p5div8);
	const nv = F.mul(n, v);
	const i = F.mul(F.mul(nv, _2n$2), v);
	const root = F.mul(nv, F.sub(i, F.ONE));
	assertIsSquare(F, root, n);
	return root;
}
function sqrt9mod16(P) {
	const Fp_ = Field(P);
	const tn = tonelliShanks(P);
	const c1 = tn(Fp_, Fp_.neg(Fp_.ONE));
	const c2 = tn(Fp_, c1);
	const c3 = tn(Fp_, Fp_.neg(c1));
	const c4 = (P + _7n) / _16n;
	return ((Fp, n) => {
		const F = Fp;
		let tv1 = F.pow(n, c4);
		let tv2 = F.mul(tv1, c1);
		const tv3 = F.mul(tv1, c2);
		const tv4 = F.mul(tv1, c3);
		const e1 = F.eql(F.sqr(tv2), n);
		const e2 = F.eql(F.sqr(tv3), n);
		tv1 = F.cmov(tv1, tv2, e1);
		tv2 = F.cmov(tv4, tv3, e2);
		const e3 = F.eql(F.sqr(tv2), n);
		const root = F.cmov(tv1, tv2, e3);
		assertIsSquare(F, root, n);
		return root;
	});
}
/**
* Tonelli-Shanks square root search algorithm.
* This implementation is variable-time: it searches data-dependently for the first non-residue `Z`
* and for the smallest `i` in the main loop, unlike RFC 9380 Appendix I.4's constant-time shape.
* 1. {@link https://eprint.iacr.org/2012/685.pdf | eprint 2012/685}, page 12
* 2. Square Roots from 1; 24, 51, 10 to Dan Shanks
* @param P - field order
* @returns function that takes field Fp (created from P) and number n
* @throws If the field is too small, non-prime, or the square root does not exist. {@link Error}
* @example
* Construct a square-root helper for primes that need Tonelli-Shanks.
*
* ```ts
* import { Field, tonelliShanks } from '@noble/curves/abstract/modular.js';
* const Fp = Field(17n);
* const sqrt = tonelliShanks(17n)(Fp, 4n);
* ```
*/
function tonelliShanks(P) {
	if (P < _3n$1) throw new Error("sqrt is not defined for small field");
	let Q = P - _1n$2;
	let S = 0;
	while (Q % _2n$2 === _0n$3) {
		Q /= _2n$2;
		S++;
	}
	let Z = _2n$2;
	const _Fp = Field(P);
	while (FpLegendre(_Fp, Z) === 1) if (Z++ > 1e3) throw new Error("Cannot find square root: probably non-prime P");
	if (S === 1) return sqrt3mod4;
	let cc = _Fp.pow(Z, Q);
	const Q1div2 = (Q + _1n$2) / _2n$2;
	return function tonelliSlow(Fp, n) {
		const F = Fp;
		if (F.is0(n)) return n;
		if (FpLegendre(F, n) !== 1) throw new Error("Cannot find square root");
		let M = S;
		let c = F.mul(F.ONE, cc);
		let t = F.pow(n, Q);
		let R = F.pow(n, Q1div2);
		while (!F.eql(t, F.ONE)) {
			if (F.is0(t)) return F.ZERO;
			let i = 1;
			let t_tmp = F.sqr(t);
			while (!F.eql(t_tmp, F.ONE)) {
				i++;
				t_tmp = F.sqr(t_tmp);
				if (i === M) throw new Error("Cannot find square root");
			}
			const exponent = _1n$2 << BigInt(M - i - 1);
			const b = F.pow(c, exponent);
			M = i;
			c = F.sqr(b);
			t = F.mul(t, c);
			R = F.mul(R, b);
		}
		return R;
	};
}
/**
* Square root for a finite field. Will try optimized versions first:
*
* 1. P ≡ 3 (mod 4)
* 2. P ≡ 5 (mod 8)
* 3. P ≡ 9 (mod 16)
* 4. Tonelli-Shanks algorithm
*
* Different algorithms can give different roots, it is up to user to decide which one they want.
* For example there is FpSqrtOdd/FpSqrtEven to choose a root by oddness
* (used for hash-to-curve).
* @param P - Field order.
* @returns Square-root helper. The generic fallback inherits Tonelli-Shanks' variable-time
*   behavior and this selector assumes prime-field-style integer moduli.
* @throws If the field is unsupported or the square root does not exist. {@link Error}
* @example
* Choose the square-root helper appropriate for one field modulus.
*
* ```ts
* import { Field, FpSqrt } from '@noble/curves/abstract/modular.js';
* const Fp = Field(17n);
* const sqrt = FpSqrt(17n)(Fp, 4n);
* ```
*/
function FpSqrt(P) {
	if (P % _4n$1 === _3n$1) return sqrt3mod4;
	if (P % _8n === _5n) return sqrt5mod8;
	if (P % _16n === _9n) return sqrt9mod16(P);
	return tonelliShanks(P);
}
const FIELD_FIELDS = [
	"create",
	"isValid",
	"is0",
	"neg",
	"inv",
	"sqrt",
	"sqr",
	"eql",
	"add",
	"sub",
	"mul",
	"pow",
	"div",
	"addN",
	"subN",
	"mulN",
	"sqrN"
];
/**
* @param field - Field implementation.
* @returns Validated field. This only checks the arithmetic subset needed by generic helpers; it
*   does not guarantee full runtime-method coverage for serialization, batching, `cmov`, or
*   field-specific extras beyond positive `BYTES` / `BITS`.
* @throws If the field shape or numeric metadata are invalid. {@link Error}
* @example
* Check that a field implementation exposes the operations curve code expects.
*
* ```ts
* import { Field, validateField } from '@noble/curves/abstract/modular.js';
* const Fp = validateField(Field(17n));
* ```
*/
function validateField(field) {
	validateObject(field, FIELD_FIELDS.reduce((map, val) => {
		map[val] = "function";
		return map;
	}, {
		ORDER: "bigint",
		BYTES: "number",
		BITS: "number"
	}));
	asafenumber(field.BYTES, "BYTES");
	asafenumber(field.BITS, "BITS");
	if (field.BYTES < 1 || field.BITS < 1) throw new Error("invalid field: expected BYTES/BITS > 0");
	if (field.ORDER <= _1n$2) throw new Error("invalid field: expected ORDER > 1, got " + field.ORDER);
	return field;
}
/**
* Same as `pow` but for Fp: non-constant-time.
* Unsafe in some contexts: uses ladder, so can expose bigint bits.
* @param Fp - Field implementation.
* @param num - Base value.
* @param power - Exponent value.
* @returns Powered field element.
* @throws If the exponent is negative. {@link Error}
* @example
* Raise one field element to a public exponent.
*
* ```ts
* import { Field, FpPow } from '@noble/curves/abstract/modular.js';
* const Fp = Field(17n);
* const x = FpPow(Fp, 3n, 5n);
* ```
*/
function FpPow(Fp, num, power) {
	const F = Fp;
	if (power < _0n$3) throw new Error("invalid exponent, negatives unsupported");
	if (power === _0n$3) return F.ONE;
	if (power === _1n$2) return num;
	let p = F.ONE;
	let d = num;
	while (power > _0n$3) {
		if (power & _1n$2) p = F.mul(p, d);
		d = F.sqr(d);
		power >>= _1n$2;
	}
	return p;
}
/**
* Efficiently invert an array of Field elements.
* Exception-free. Zero-valued field elements stay `undefined` unless `passZero` is enabled.
* @param Fp - Field implementation.
* @param nums - Values to invert.
* @param passZero - map 0 to 0 (instead of undefined)
* @returns Inverted values.
* @example
* Invert several field elements with one shared inversion.
*
* ```ts
* import { Field, FpInvertBatch } from '@noble/curves/abstract/modular.js';
* const Fp = Field(17n);
* const inv = FpInvertBatch(Fp, [1n, 2n, 4n]);
* ```
*/
function FpInvertBatch(Fp, nums, passZero = false) {
	const F = Fp;
	const inverted = new Array(nums.length).fill(passZero ? F.ZERO : void 0);
	const multipliedAcc = nums.reduce((acc, num, i) => {
		if (F.is0(num)) return acc;
		inverted[i] = acc;
		return F.mul(acc, num);
	}, F.ONE);
	const invertedAcc = F.inv(multipliedAcc);
	nums.reduceRight((acc, num, i) => {
		if (F.is0(num)) return acc;
		inverted[i] = F.mul(acc, inverted[i]);
		return F.mul(acc, num);
	}, invertedAcc);
	return inverted;
}
/**
* Legendre symbol.
* Legendre constant is used to calculate Legendre symbol (a | p)
* which denotes the value of a^((p-1)/2) (mod p).
*
* * (a | p) ≡ 1    if a is a square (mod p), quadratic residue
* * (a | p) ≡ -1   if a is not a square (mod p), quadratic non residue
* * (a | p) ≡ 0    if a ≡ 0 (mod p)
* @param Fp - Field implementation.
* @param n - Value to inspect.
* @returns Legendre symbol.
* @throws If the field returns an invalid Legendre symbol value. {@link Error}
* @example
* Compute the Legendre symbol of one field element.
*
* ```ts
* import { Field, FpLegendre } from '@noble/curves/abstract/modular.js';
* const Fp = Field(17n);
* const symbol = FpLegendre(Fp, 4n);
* ```
*/
function FpLegendre(Fp, n) {
	const F = Fp;
	const p1mod2 = (F.ORDER - _1n$2) / _2n$2;
	const powered = F.pow(n, p1mod2);
	const yes = F.eql(powered, F.ONE);
	const zero = F.eql(powered, F.ZERO);
	const no = F.eql(powered, F.neg(F.ONE));
	if (!yes && !zero && !no) throw new Error("invalid Legendre symbol result");
	return yes ? 1 : zero ? 0 : -1;
}
/**
* @param n - Curve order. Callers are expected to pass a positive order.
* @param nBitLength - Optional cached bit length. Callers are expected to pass a positive cached
*   value when overriding the derived bit length.
* @returns Byte and bit lengths.
* @throws If the order or cached bit length is invalid. {@link Error}
* @example
* Measure the encoding sizes needed for one modulus.
*
* ```ts
* nLength(255n);
* ```
*/
function nLength(n, nBitLength) {
	if (nBitLength !== void 0) anumber$1(nBitLength);
	if (n <= _0n$3) throw new Error("invalid n length: expected positive n, got " + n);
	if (nBitLength !== void 0 && nBitLength < 1) throw new Error("invalid n length: expected positive bit length, got " + nBitLength);
	const bits = bitLen(n);
	if (nBitLength !== void 0 && nBitLength < bits) throw new Error(`invalid n length: expected bit length (${bits}) >= n.length (${nBitLength})`);
	const _nBitLength = nBitLength !== void 0 ? nBitLength : bits;
	return {
		nBitLength: _nBitLength,
		nByteLength: Math.ceil(_nBitLength / 8)
	};
}
const FIELD_SQRT = /* @__PURE__ */ new WeakMap();
var _Field = class {
	ORDER;
	BITS;
	BYTES;
	isLE;
	ZERO = _0n$3;
	ONE = _1n$2;
	_lengths;
	_mod;
	constructor(ORDER, opts = {}) {
		if (ORDER <= _1n$2) throw new Error("invalid field: expected ORDER > 1, got " + ORDER);
		let _nbitLength = void 0;
		this.isLE = false;
		if (opts != null && typeof opts === "object") {
			if (typeof opts.BITS === "number") _nbitLength = opts.BITS;
			if (typeof opts.sqrt === "function") Object.defineProperty(this, "sqrt", {
				value: opts.sqrt,
				enumerable: true
			});
			if (typeof opts.isLE === "boolean") this.isLE = opts.isLE;
			if (opts.allowedLengths) this._lengths = Object.freeze(opts.allowedLengths.slice());
			if (typeof opts.modFromBytes === "boolean") this._mod = opts.modFromBytes;
		}
		const { nBitLength, nByteLength } = nLength(ORDER, _nbitLength);
		if (nByteLength > 2048) throw new Error("invalid field: expected ORDER of <= 2048 bytes");
		this.ORDER = ORDER;
		this.BITS = nBitLength;
		this.BYTES = nByteLength;
		Object.freeze(this);
	}
	create(num) {
		return mod(num, this.ORDER);
	}
	isValid(num) {
		if (typeof num !== "bigint") throw new TypeError("invalid field element: expected bigint, got " + typeof num);
		return _0n$3 <= num && num < this.ORDER;
	}
	is0(num) {
		return num === _0n$3;
	}
	isValidNot0(num) {
		return !this.is0(num) && this.isValid(num);
	}
	isOdd(num) {
		return (num & _1n$2) === _1n$2;
	}
	neg(num) {
		return mod(-num, this.ORDER);
	}
	eql(lhs, rhs) {
		return lhs === rhs;
	}
	sqr(num) {
		return mod(num * num, this.ORDER);
	}
	add(lhs, rhs) {
		return mod(lhs + rhs, this.ORDER);
	}
	sub(lhs, rhs) {
		return mod(lhs - rhs, this.ORDER);
	}
	mul(lhs, rhs) {
		return mod(lhs * rhs, this.ORDER);
	}
	pow(num, power) {
		return FpPow(this, num, power);
	}
	div(lhs, rhs) {
		return mod(lhs * invert(rhs, this.ORDER), this.ORDER);
	}
	sqrN(num) {
		return num * num;
	}
	addN(lhs, rhs) {
		return lhs + rhs;
	}
	subN(lhs, rhs) {
		return lhs - rhs;
	}
	mulN(lhs, rhs) {
		return lhs * rhs;
	}
	inv(num) {
		return invert(num, this.ORDER);
	}
	sqrt(num) {
		let sqrt = FIELD_SQRT.get(this);
		if (!sqrt) FIELD_SQRT.set(this, sqrt = FpSqrt(this.ORDER));
		return sqrt(this, num);
	}
	toBytes(num) {
		return this.isLE ? numberToBytesLE(num, this.BYTES) : numberToBytesBE(num, this.BYTES);
	}
	fromBytes(bytes, skipValidation = false) {
		abytes$1(bytes);
		const { _lengths: allowedLengths, BYTES, isLE, ORDER, _mod: modFromBytes } = this;
		if (allowedLengths) {
			if (bytes.length < 1 || !allowedLengths.includes(bytes.length) || bytes.length > BYTES) throw new Error("Field.fromBytes: expected " + allowedLengths + " bytes, got " + bytes.length);
			const padded = new Uint8Array(BYTES);
			padded.set(bytes, isLE ? 0 : padded.length - bytes.length);
			bytes = padded;
		}
		if (bytes.length !== BYTES) throw new Error("Field.fromBytes: expected " + BYTES + " bytes, got " + bytes.length);
		let scalar = isLE ? bytesToNumberLE(bytes) : bytesToNumberBE(bytes);
		if (modFromBytes) scalar = mod(scalar, ORDER);
		if (!skipValidation) {
			if (!this.isValid(scalar)) throw new Error("invalid field element: outside of range 0..ORDER");
		}
		return scalar;
	}
	invertBatch(lst) {
		return FpInvertBatch(this, lst);
	}
	cmov(a, b, condition) {
		abool$1(condition, "condition");
		return condition ? b : a;
	}
};
Object.freeze(_Field.prototype);
/**
* Creates a finite field. Major performance optimizations:
* * 1. Denormalized operations like mulN instead of mul.
* * 2. Identical object shape: never add or remove keys.
* * 3. Frozen stable object shape; the lazy sqrt cache lives in a module-level `WeakMap`.
* Fragile: always run a benchmark on a change.
* Security note: operations and low-level serializers like `toBytes` don't check `isValid` for
* all elements for performance and protocol-flexibility reasons; callers are responsible for
* supplying valid elements when they need canonical field behavior.
* This is low-level code, please make sure you know what you're doing.
*
* Note about field properties:
* * CHARACTERISTIC p = prime number, number of elements in main subgroup.
* * ORDER q = similar to cofactor in curves, may be composite `q = p^m`.
*
* @param ORDER - field order, probably prime, or could be composite
* @param opts - Field options such as bit length or endianness. See {@link FieldOpts}.
* @returns Frozen field instance with a stable object shape. This wrapper forwards `opts` straight
*   into `_Field`, so it inherits `_Field`'s assumptions about cached sizes and `allowedLengths`.
* @example
* Construct one prime field with optional overrides.
*
* ```ts
* Field(11n);
* ```
*/
function Field(ORDER, opts = {}) {
	return new _Field(ORDER, opts);
}
/**
* Returns total number of bytes consumed by the field element.
* For example, 32 bytes for usual 256-bit weierstrass curve.
* @param fieldOrder - number of field elements, usually CURVE.n. Callers are expected to pass an
*   order greater than 1.
* @returns byte length of field
* @throws If the field order is not a bigint. {@link Error}
* @example
* Read the fixed-width byte length of one field.
*
* ```ts
* getFieldBytesLength(255n);
* ```
*/
function getFieldBytesLength(fieldOrder) {
	if (typeof fieldOrder !== "bigint") throw new Error("field order must be bigint");
	if (fieldOrder <= _1n$2) throw new Error("field order must be greater than 1");
	const bitLength = bitLen(fieldOrder - _1n$2);
	return Math.ceil(bitLength / 8);
}
/**
* Returns minimal amount of bytes that can be safely reduced
* by field order.
* Should be 2^-128 for 128-bit curve such as P256.
* This is the reduction / modulo-bias lower bound; higher-level helpers may still impose a larger
* absolute floor for policy reasons.
* @param fieldOrder - number of field elements greater than 1, usually CURVE.n.
* @returns byte length of target hash
* @throws If the field order is invalid. {@link Error}
* @example
* Compute the minimum hash length needed for field reduction.
*
* ```ts
* getMinHashLength(255n);
* ```
*/
function getMinHashLength(fieldOrder) {
	const length = getFieldBytesLength(fieldOrder);
	return length + Math.ceil(length / 2);
}
/**
* "Constant-time" private key generation utility.
* Can take (n + n/2) or more bytes of uniform input e.g. from CSPRNG or KDF
* and convert them into private scalar, with the modulo bias being negligible.
* Needs at least 48 bytes of input for 32-byte private key. The implementation also keeps a hard
* 16-byte minimum even when `getMinHashLength(...)` is smaller, so toy-small inputs do not look
* accidentally acceptable for real scalar derivation.
* See {@link https://research.kudelskisecurity.com/2020/07/28/the-definitive-guide-to-modulo-bias-and-how-to-avoid-it/ | Kudelski's modulo-bias guide},
* {@link https://csrc.nist.gov/publications/detail/fips/186/5/final | FIPS 186-5 appendix A.2}, and
* {@link https://www.rfc-editor.org/rfc/rfc9380#section-5 | RFC 9380 section 5}. Unlike RFC 9380
* `hash_to_field`, this helper intentionally maps into the non-zero private-scalar range `1..n-1`.
* @param key - Uniform input bytes.
* @param fieldOrder - Size of subgroup.
* @param isLE - interpret hash bytes as LE num
* @returns valid private scalar
* @throws If the hash length or field order is invalid for scalar reduction. {@link Error}
* @example
* Map hash output into a private scalar range.
*
* ```ts
* mapHashToField(new Uint8Array(48).fill(1), 255n);
* ```
*/
function mapHashToField(key, fieldOrder, isLE = false) {
	abytes$1(key);
	const len = key.length;
	const fieldLen = getFieldBytesLength(fieldOrder);
	const minLen = Math.max(getMinHashLength(fieldOrder), 16);
	if (len < minLen || len > 1024) throw new Error("expected " + minLen + "-1024 bytes of input, got " + len);
	const reduced = mod(isLE ? bytesToNumberLE(key) : bytesToNumberBE(key), fieldOrder - _1n$2) + _1n$2;
	return isLE ? numberToBytesLE(reduced, fieldLen) : numberToBytesBE(reduced, fieldLen);
}
//#endregion
//#region node_modules/@noble/curves/abstract/curve.js
/**
* Methods for elliptic curve multiplication by scalars.
* Contains wNAF, pippenger.
* @module
*/
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const _0n$2 = /* @__PURE__ */ BigInt(0);
const _1n$1 = /* @__PURE__ */ BigInt(1);
/**
* Computes both candidates first, but the final selection still branches on `condition`, so this
* is not a strict constant-time CMOV primitive.
* @param condition - Whether to negate the point.
* @param item - Point-like value.
* @returns Original or negated value.
* @example
* Keep the point or return its negation based on one boolean branch.
*
* ```ts
* import { negateCt } from '@noble/curves/abstract/curve.js';
* import { p256 } from '@noble/curves/nist.js';
* const maybeNegated = negateCt(true, p256.Point.BASE);
* ```
*/
function negateCt(condition, item) {
	const neg = item.negate();
	return condition ? neg : item;
}
/**
* Takes a bunch of Projective Points but executes only one
* inversion on all of them. Inversion is very slow operation,
* so this improves performance massively.
* Optimization: converts a list of projective points to a list of identical points with Z=1.
* Input points are left unchanged; the normalized points are returned as fresh instances.
* @param c - Point constructor.
* @param points - Projective points.
* @returns Fresh projective points reconstructed from normalized affine coordinates.
* @example
* Batch-normalize projective points with a single shared inversion.
*
* ```ts
* import { normalizeZ } from '@noble/curves/abstract/curve.js';
* import { p256 } from '@noble/curves/nist.js';
* const points = normalizeZ(p256.Point, [p256.Point.BASE, p256.Point.BASE.double()]);
* ```
*/
function normalizeZ(c, points) {
	const invertedZs = FpInvertBatch(c.Fp, points.map((p) => p.Z));
	return points.map((p, i) => c.fromAffine(p.toAffine(invertedZs[i])));
}
function validateW(W, bits) {
	if (!Number.isSafeInteger(W) || W <= 0 || W > bits) throw new Error("invalid window size, expected [1.." + bits + "], got W=" + W);
}
function calcWOpts(W, scalarBits) {
	validateW(W, scalarBits);
	const windows = Math.ceil(scalarBits / W) + 1;
	const windowSize = 2 ** (W - 1);
	const maxNumber = 2 ** W;
	return {
		windows,
		windowSize,
		mask: bitMask(W),
		maxNumber,
		shiftBy: BigInt(W)
	};
}
function calcOffsets(n, window, wOpts) {
	const { windowSize, mask, maxNumber, shiftBy } = wOpts;
	let wbits = Number(n & mask);
	let nextN = n >> shiftBy;
	if (wbits > windowSize) {
		wbits -= maxNumber;
		nextN += _1n$1;
	}
	const offsetStart = window * windowSize;
	const offset = offsetStart + Math.abs(wbits) - 1;
	const isZero = wbits === 0;
	const isNeg = wbits < 0;
	const isNegF = window % 2 !== 0;
	return {
		nextN,
		offset,
		isZero,
		isNeg,
		isNegF,
		offsetF: offsetStart
	};
}
const pointPrecomputes = /* @__PURE__ */ new WeakMap();
const pointWindowSizes = /* @__PURE__ */ new WeakMap();
function getW(P) {
	return pointWindowSizes.get(P) || 1;
}
function assert0(n) {
	if (n !== _0n$2) throw new Error("invalid wNAF");
}
/**
* Elliptic curve multiplication of Point by scalar. Fragile.
* Table generation takes **30MB of ram and 10ms on high-end CPU**,
* but may take much longer on slow devices. Actual generation will happen on
* first call of `multiply()`. By default, `BASE` point is precomputed.
*
* Scalars should always be less than curve order: this should be checked inside of a curve itself.
* Creates precomputation tables for fast multiplication:
* - private scalar is split by fixed size windows of W bits
* - every window point is collected from window's table & added to accumulator
* - since windows are different, same point inside tables won't be accessed more than once per calc
* - each multiplication is 'Math.ceil(CURVE_ORDER / 𝑊) + 1' point additions (fixed for any scalar)
* - +1 window is neccessary for wNAF
* - wNAF reduces table size: 2x less memory + 2x faster generation, but 10% slower multiplication
*
* TODO: research returning a 2d JS array of windows instead of a single window.
* This would allow windows to be in different memory locations.
* @param Point - Point constructor.
* @param bits - Scalar bit length.
* @example
* Elliptic curve multiplication of Point by scalar.
*
* ```ts
* import { wNAF } from '@noble/curves/abstract/curve.js';
* import { p256 } from '@noble/curves/nist.js';
* const ladder = new wNAF(p256.Point, p256.Point.Fn.BITS);
* ```
*/
var wNAF = class {
	BASE;
	ZERO;
	Fn;
	bits;
	constructor(Point, bits) {
		this.BASE = Point.BASE;
		this.ZERO = Point.ZERO;
		this.Fn = Point.Fn;
		this.bits = bits;
	}
	_unsafeLadder(elm, n, p = this.ZERO) {
		let d = elm;
		while (n > _0n$2) {
			if (n & _1n$1) p = p.add(d);
			d = d.double();
			n >>= _1n$1;
		}
		return p;
	}
	/**
	* Creates a wNAF precomputation window. Used for caching.
	* Default window size is set by `utils.precompute()` and is equal to 8.
	* Number of precomputed points depends on the curve size:
	* 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
	* - 𝑊 is the window size
	* - 𝑛 is the bitlength of the curve order.
	* For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
	* @param point - Point instance
	* @param W - window size
	* @returns precomputed point tables flattened to a single array
	*/
	precomputeWindow(point, W) {
		const { windows, windowSize } = calcWOpts(W, this.bits);
		const points = [];
		let p = point;
		let base = p;
		for (let window = 0; window < windows; window++) {
			base = p;
			points.push(base);
			for (let i = 1; i < windowSize; i++) {
				base = base.add(p);
				points.push(base);
			}
			p = base.double();
		}
		return points;
	}
	/**
	* Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
	* More compact implementation:
	* https://github.com/paulmillr/noble-secp256k1/blob/47cb1669b6e506ad66b35fe7d76132ae97465da2/index.ts#L502-L541
	* @returns real and fake (for const-time) points
	*/
	wNAF(W, precomputes, n) {
		if (!this.Fn.isValid(n)) throw new Error("invalid scalar");
		let p = this.ZERO;
		let f = this.BASE;
		const wo = calcWOpts(W, this.bits);
		for (let window = 0; window < wo.windows; window++) {
			const { nextN, offset, isZero, isNeg, isNegF, offsetF } = calcOffsets(n, window, wo);
			n = nextN;
			if (isZero) f = f.add(negateCt(isNegF, precomputes[offsetF]));
			else p = p.add(negateCt(isNeg, precomputes[offset]));
		}
		assert0(n);
		return {
			p,
			f
		};
	}
	/**
	* Implements unsafe EC multiplication using precomputed tables
	* and w-ary non-adjacent form.
	* @param acc - accumulator point to add result of multiplication
	* @returns point
	*/
	wNAFUnsafe(W, precomputes, n, acc = this.ZERO) {
		const wo = calcWOpts(W, this.bits);
		for (let window = 0; window < wo.windows; window++) {
			if (n === _0n$2) break;
			const { nextN, offset, isZero, isNeg } = calcOffsets(n, window, wo);
			n = nextN;
			if (isZero) continue;
			else {
				const item = precomputes[offset];
				acc = acc.add(isNeg ? item.negate() : item);
			}
		}
		assert0(n);
		return acc;
	}
	getPrecomputes(W, point, transform) {
		let comp = pointPrecomputes.get(point);
		if (!comp) {
			comp = this.precomputeWindow(point, W);
			if (W !== 1) {
				if (typeof transform === "function") comp = transform(comp);
				pointPrecomputes.set(point, comp);
			}
		}
		return comp;
	}
	cached(point, scalar, transform) {
		const W = getW(point);
		return this.wNAF(W, this.getPrecomputes(W, point, transform), scalar);
	}
	unsafe(point, scalar, transform, prev) {
		const W = getW(point);
		if (W === 1) return this._unsafeLadder(point, scalar, prev);
		return this.wNAFUnsafe(W, this.getPrecomputes(W, point, transform), scalar, prev);
	}
	createCache(P, W) {
		validateW(W, this.bits);
		pointWindowSizes.set(P, W);
		pointPrecomputes.delete(P);
	}
	hasCache(elm) {
		return getW(elm) !== 1;
	}
};
/**
* Endomorphism-specific multiplication for Koblitz curves.
* Cost: 128 dbl, 0-256 adds.
* @param Point - Point constructor.
* @param point - Input point.
* @param k1 - First non-negative absolute scalar chunk.
* @param k2 - Second non-negative absolute scalar chunk.
* @returns Partial multiplication results.
* @example
* Endomorphism-specific multiplication for Koblitz curves.
*
* ```ts
* import { mulEndoUnsafe } from '@noble/curves/abstract/curve.js';
* import { secp256k1 } from '@noble/curves/secp256k1.js';
* const parts = mulEndoUnsafe(secp256k1.Point, secp256k1.Point.BASE, 3n, 5n);
* ```
*/
function mulEndoUnsafe(Point, point, k1, k2) {
	let acc = point;
	let p1 = Point.ZERO;
	let p2 = Point.ZERO;
	while (k1 > _0n$2 || k2 > _0n$2) {
		if (k1 & _1n$1) p1 = p1.add(acc);
		if (k2 & _1n$1) p2 = p2.add(acc);
		acc = acc.double();
		k1 >>= _1n$1;
		k2 >>= _1n$1;
	}
	return {
		p1,
		p2
	};
}
function createField(order, field, isLE) {
	if (field) {
		if (field.ORDER !== order) throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
		validateField(field);
		return field;
	} else return Field(order, { isLE });
}
/**
* Validates basic CURVE shape and field membership, then creates fields.
* This does not prove that the generator is on-curve, that subgroup/order data are consistent, or
* that the curve equation itself is otherwise sane.
* @param type - Curve family.
* @param CURVE - Curve parameters.
* @param curveOpts - Optional field overrides:
*   - `Fp` (optional): Optional base-field override.
*   - `Fn` (optional): Optional scalar-field override.
* @param FpFnLE - Whether field encoding is little-endian.
* @returns Frozen curve parameters and fields.
* @throws If the curve parameters or field overrides are invalid. {@link Error}
* @example
* Build curve fields from raw constants before constructing a curve instance.
*
* ```ts
* const curve = createCurveFields('weierstrass', {
*   p: 17n,
*   n: 19n,
*   h: 1n,
*   a: 2n,
*   b: 2n,
*   Gx: 5n,
*   Gy: 1n,
* });
* ```
*/
function createCurveFields(type, CURVE, curveOpts = {}, FpFnLE) {
	if (FpFnLE === void 0) FpFnLE = type === "edwards";
	if (!CURVE || typeof CURVE !== "object") throw new Error(`expected valid ${type} CURVE object`);
	for (const p of [
		"p",
		"n",
		"h"
	]) {
		const val = CURVE[p];
		if (!(typeof val === "bigint" && val > _0n$2)) throw new Error(`CURVE.${p} must be positive bigint`);
	}
	const Fp = createField(CURVE.p, curveOpts.Fp, FpFnLE);
	const Fn = createField(CURVE.n, curveOpts.Fn, FpFnLE);
	const params = [
		"Gx",
		"Gy",
		"a",
		type === "weierstrass" ? "b" : "d"
	];
	for (const p of params) if (!Fp.isValid(CURVE[p])) throw new Error(`CURVE.${p} must be valid field element of CURVE.Fp`);
	CURVE = Object.freeze(Object.assign({}, CURVE));
	return {
		CURVE,
		Fp,
		Fn
	};
}
/**
* @param randomSecretKey - Secret-key generator.
* @param getPublicKey - Public-key derivation helper.
* @returns Keypair generator.
* @example
* Build a `keygen()` helper from existing secret-key and public-key primitives.
*
* ```ts
* import { createKeygen } from '@noble/curves/abstract/curve.js';
* import { p256 } from '@noble/curves/nist.js';
* const keygen = createKeygen(p256.utils.randomSecretKey, p256.getPublicKey);
* const pair = keygen();
* ```
*/
function createKeygen(randomSecretKey, getPublicKey) {
	return function keygen(seed) {
		const secretKey = randomSecretKey(seed);
		return {
			secretKey,
			publicKey: getPublicKey(secretKey)
		};
	};
}
//#endregion
//#region node_modules/@noble/hashes/hmac.js
/**
* HMAC: RFC2104 message authentication code.
* @module
*/
/**
* Internal class for HMAC.
* Accepts any byte key, although RFC 2104 §3 recommends keys at least
* `HashLen` bytes long.
*/
var _HMAC = class {
	oHash;
	iHash;
	blockLen;
	outputLen;
	canXOF = false;
	finished = false;
	destroyed = false;
	constructor(hash, key) {
		ahash(hash);
		abytes$2(key, void 0, "key");
		this.iHash = hash.create();
		if (typeof this.iHash.update !== "function") throw new Error("Expected instance of class which extends utils.Hash");
		this.blockLen = this.iHash.blockLen;
		this.outputLen = this.iHash.outputLen;
		const blockLen = this.blockLen;
		const pad = new Uint8Array(blockLen);
		pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
		for (let i = 0; i < pad.length; i++) pad[i] ^= 54;
		this.iHash.update(pad);
		this.oHash = hash.create();
		for (let i = 0; i < pad.length; i++) pad[i] ^= 106;
		this.oHash.update(pad);
		clean$1(pad);
	}
	update(buf) {
		aexists$1(this);
		this.iHash.update(buf);
		return this;
	}
	digestInto(out) {
		aexists$1(this);
		aoutput$1(out, this);
		this.finished = true;
		const buf = out.subarray(0, this.outputLen);
		this.iHash.digestInto(buf);
		this.oHash.update(buf);
		this.oHash.digestInto(buf);
		this.destroy();
	}
	digest() {
		const out = new Uint8Array(this.oHash.outputLen);
		this.digestInto(out);
		return out;
	}
	_cloneInto(to) {
		to ||= Object.create(Object.getPrototypeOf(this), {});
		const { oHash, iHash, finished, destroyed, blockLen, outputLen } = this;
		to = to;
		to.finished = finished;
		to.destroyed = destroyed;
		to.blockLen = blockLen;
		to.outputLen = outputLen;
		to.oHash = oHash._cloneInto(to.oHash);
		to.iHash = iHash._cloneInto(to.iHash);
		return to;
	}
	clone() {
		return this._cloneInto();
	}
	destroy() {
		this.destroyed = true;
		this.oHash.destroy();
		this.iHash.destroy();
	}
};
const hmac = /* @__PURE__ */ (() => {
	const hmac_ = ((hash, key, message) => new _HMAC(hash, key).update(message).digest());
	hmac_.create = (hash, key) => new _HMAC(hash, key);
	return hmac_;
})();
//#endregion
//#region node_modules/@noble/curves/abstract/weierstrass.js
/**
* Short Weierstrass curve methods. The formula is: y² = x³ + ax + b.
*
* ### Design rationale for types
*
* * Interaction between classes from different curves should fail:
*   `k256.Point.BASE.add(p256.Point.BASE)`
* * For this purpose we want to use `instanceof` operator, which is fast and works during runtime
* * Different calls of `curve()` would return different classes -
*   `curve(params) !== curve(params)`: if somebody decided to monkey-patch their curve,
*   it won't affect others
*
* TypeScript can't infer types for classes created inside a function. Classes is one instance
* of nominative types in TypeScript and interfaces only check for shape, so it's hard to create
* unique type for every function call.
*
* We can use generic types via some param, like curve opts, but that would:
*     1. Enable interaction between `curve(params)` and `curve(params)` (curves of same params)
*     which is hard to debug.
*     2. Params can be generic and we can't enforce them to be constant value:
*     if somebody creates curve from non-constant params,
*     it would be allowed to interact with other curves with non-constant params
*
* @todo https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-7.html#unique-symbol
* @module
*/
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const divNearest = (num, den) => (num + (num >= 0 ? den : -den) / _2n$1) / den;
/** Splits scalar for GLV endomorphism. */
function _splitEndoScalar(k, basis, n) {
	aInRange("scalar", k, _0n$1, n);
	const [[a1, b1], [a2, b2]] = basis;
	const c1 = divNearest(b2 * k, n);
	const c2 = divNearest(-b1 * k, n);
	let k1 = k - c1 * a1 - c2 * a2;
	let k2 = -c1 * b1 - c2 * b2;
	const k1neg = k1 < _0n$1;
	const k2neg = k2 < _0n$1;
	if (k1neg) k1 = -k1;
	if (k2neg) k2 = -k2;
	const MAX_NUM = bitMask(Math.ceil(bitLen(n) / 2)) + _1n;
	if (k1 < _0n$1 || k1 >= MAX_NUM || k2 < _0n$1 || k2 >= MAX_NUM) throw new Error("splitScalar (endomorphism): failed for k");
	return {
		k1neg,
		k1,
		k2neg,
		k2
	};
}
function validateSigFormat(format) {
	if (![
		"compact",
		"recovered",
		"der"
	].includes(format)) throw new Error("Signature format must be \"compact\", \"recovered\", or \"der\"");
	return format;
}
function validateSigOpts(opts, def) {
	validateObject(opts);
	const optsn = {};
	for (let optName of Object.keys(def)) optsn[optName] = opts[optName] === void 0 ? def[optName] : opts[optName];
	abool$1(optsn.lowS, "lowS");
	abool$1(optsn.prehash, "prehash");
	if (optsn.format !== void 0) validateSigFormat(optsn.format);
	return optsn;
}
/**
* @param m - Error message.
* @example
* Throw a DER-specific error when signature parsing encounters invalid bytes.
*
* ```ts
* new DERErr('bad der');
* ```
*/
var DERErr = class extends Error {
	constructor(m = "") {
		super(m);
	}
};
/**
* ASN.1 DER encoding utilities. ASN is very complex & fragile. Format:
*
*     [0x30 (SEQUENCE), bytelength, 0x02 (INTEGER), intLength, R, 0x02 (INTEGER), intLength, S]
*
* Docs: {@link https://letsencrypt.org/docs/a-warm-welcome-to-asn1-and-der/ | Let's Encrypt ASN.1 guide} and
* {@link https://luca.ntop.org/Teaching/Appunti/asn1.html | Luca Deri's ASN.1 notes}.
* @example
* ASN.1 DER encoding utilities.
*
* ```ts
* const der = DER.hexFromSig({ r: 1n, s: 2n });
* ```
*/
const DER = {
	Err: DERErr,
	_tlv: {
		encode: (tag, data) => {
			const { Err: E } = DER;
			asafenumber(tag, "tag");
			if (tag < 0 || tag > 255) throw new E("tlv.encode: wrong tag");
			if (typeof data !== "string") throw new TypeError("\"data\" expected string, got type=" + typeof data);
			if (data.length & 1) throw new E("tlv.encode: unpadded data");
			const dataLen = data.length / 2;
			const len = numberToHexUnpadded(dataLen);
			if (len.length / 2 & 128) throw new E("tlv.encode: long form length too big");
			const lenLen = dataLen > 127 ? numberToHexUnpadded(len.length / 2 | 128) : "";
			return numberToHexUnpadded(tag) + lenLen + len + data;
		},
		decode(tag, data) {
			const { Err: E } = DER;
			data = abytes$1(data, void 0, "DER data");
			let pos = 0;
			if (tag < 0 || tag > 255) throw new E("tlv.encode: wrong tag");
			if (data.length < 2 || data[pos++] !== tag) throw new E("tlv.decode: wrong tlv");
			const first = data[pos++];
			const isLong = !!(first & 128);
			let length = 0;
			if (!isLong) length = first;
			else {
				const lenLen = first & 127;
				if (!lenLen) throw new E("tlv.decode(long): indefinite length not supported");
				if (lenLen > 4) throw new E("tlv.decode(long): byte length is too big");
				const lengthBytes = data.subarray(pos, pos + lenLen);
				if (lengthBytes.length !== lenLen) throw new E("tlv.decode: length bytes not complete");
				if (lengthBytes[0] === 0) throw new E("tlv.decode(long): zero leftmost byte");
				for (const b of lengthBytes) length = length << 8 | b;
				pos += lenLen;
				if (length < 128) throw new E("tlv.decode(long): not minimal encoding");
			}
			const v = data.subarray(pos, pos + length);
			if (v.length !== length) throw new E("tlv.decode: wrong value length");
			return {
				v,
				l: data.subarray(pos + length)
			};
		}
	},
	_int: {
		encode(num) {
			const { Err: E } = DER;
			abignumber(num);
			if (num < _0n$1) throw new E("integer: negative integers are not allowed");
			let hex = numberToHexUnpadded(num);
			if (Number.parseInt(hex[0], 16) & 8) hex = "00" + hex;
			if (hex.length & 1) throw new E("unexpected DER parsing assertion: unpadded hex");
			return hex;
		},
		decode(data) {
			const { Err: E } = DER;
			if (data.length < 1) throw new E("invalid signature integer: empty");
			if (data[0] & 128) throw new E("invalid signature integer: negative");
			if (data.length > 1 && data[0] === 0 && !(data[1] & 128)) throw new E("invalid signature integer: unnecessary leading zero");
			return bytesToNumberBE(data);
		}
	},
	toSig(bytes) {
		const { Err: E, _int: int, _tlv: tlv } = DER;
		const data = abytes$1(bytes, void 0, "signature");
		const { v: seqBytes, l: seqLeftBytes } = tlv.decode(48, data);
		if (seqLeftBytes.length) throw new E("invalid signature: left bytes after parsing");
		const { v: rBytes, l: rLeftBytes } = tlv.decode(2, seqBytes);
		const { v: sBytes, l: sLeftBytes } = tlv.decode(2, rLeftBytes);
		if (sLeftBytes.length) throw new E("invalid signature: left bytes after parsing");
		return {
			r: int.decode(rBytes),
			s: int.decode(sBytes)
		};
	},
	hexFromSig(sig) {
		const { _tlv: tlv, _int: int } = DER;
		const seq = tlv.encode(2, int.encode(sig.r)) + tlv.encode(2, int.encode(sig.s));
		return tlv.encode(48, seq);
	}
};
Object.freeze(DER._tlv);
Object.freeze(DER._int);
Object.freeze(DER);
const _0n$1 = /* @__PURE__ */ BigInt(0), _1n = /* @__PURE__ */ BigInt(1), _2n$1 = /* @__PURE__ */ BigInt(2), _3n = /* @__PURE__ */ BigInt(3), _4n = /* @__PURE__ */ BigInt(4);
/**
* Creates weierstrass Point constructor, based on specified curve options.
*
* See {@link WeierstrassOpts}.
* @param params - Curve parameters. See {@link WeierstrassOpts}.
* @param extraOpts - Optional helpers and overrides. See {@link WeierstrassExtraOpts}.
* @returns Weierstrass point constructor.
* @throws If the curve parameters, overrides, or point codecs are invalid. {@link Error}
*
* @example
* Construct a point type from explicit Weierstrass curve parameters.
*
* ```js
* const opts = {
*   p: 0xfffffffffffffffffffffffffffffffeffffac73n,
*   n: 0x100000000000000000001b8fa16dfab9aca16b6b3n,
*   h: 1n,
*   a: 0n,
*   b: 7n,
*   Gx: 0x3b4c382ce37aa192a4019e763036f4f5dd4d7ebbn,
*   Gy: 0x938cf935318fdced6bc28286531733c3f03c4feen,
* };
* const secp160k1_Point = weierstrass(opts);
* ```
*/
function weierstrass(params, extraOpts = {}) {
	const validated = createCurveFields("weierstrass", params, extraOpts);
	const Fp = validated.Fp;
	const Fn = validated.Fn;
	let CURVE = validated.CURVE;
	const { h: cofactor, n: CURVE_ORDER } = CURVE;
	validateObject(extraOpts, {}, {
		allowInfinityPoint: "boolean",
		clearCofactor: "function",
		isTorsionFree: "function",
		fromBytes: "function",
		toBytes: "function",
		endo: "object"
	});
	const { endo, allowInfinityPoint } = extraOpts;
	if (endo) {
		if (!Fp.is0(CURVE.a) || typeof endo.beta !== "bigint" || !Array.isArray(endo.basises)) throw new Error("invalid endo: expected \"beta\": bigint and \"basises\": array");
	}
	const lengths = getWLengths(Fp, Fn);
	function assertCompressionIsSupported() {
		if (!Fp.isOdd) throw new Error("compression is not supported: Field does not have .isOdd()");
	}
	function pointToBytes(_c, point, isCompressed) {
		if (allowInfinityPoint && point.is0()) return Uint8Array.of(0);
		const { x, y } = point.toAffine();
		const bx = Fp.toBytes(x);
		abool$1(isCompressed, "isCompressed");
		if (isCompressed) {
			assertCompressionIsSupported();
			return concatBytes(pprefix(!Fp.isOdd(y)), bx);
		} else return concatBytes(Uint8Array.of(4), bx, Fp.toBytes(y));
	}
	function pointFromBytes(bytes) {
		abytes$1(bytes, void 0, "Point");
		const { publicKey: comp, publicKeyUncompressed: uncomp } = lengths;
		const length = bytes.length;
		const head = bytes[0];
		const tail = bytes.subarray(1);
		if (allowInfinityPoint && length === 1 && head === 0) return {
			x: Fp.ZERO,
			y: Fp.ZERO
		};
		if (length === comp && (head === 2 || head === 3)) {
			const x = Fp.fromBytes(tail);
			if (!Fp.isValid(x)) throw new Error("bad point: is not on curve, wrong x");
			const y2 = weierstrassEquation(x);
			let y;
			try {
				y = Fp.sqrt(y2);
			} catch (sqrtError) {
				const err = sqrtError instanceof Error ? ": " + sqrtError.message : "";
				throw new Error("bad point: is not on curve, sqrt error" + err);
			}
			assertCompressionIsSupported();
			const evenY = Fp.isOdd(y);
			if ((head & 1) === 1 !== evenY) y = Fp.neg(y);
			return {
				x,
				y
			};
		} else if (length === uncomp && head === 4) {
			const L = Fp.BYTES;
			const x = Fp.fromBytes(tail.subarray(0, L));
			const y = Fp.fromBytes(tail.subarray(L, L * 2));
			if (!isValidXY(x, y)) throw new Error("bad point: is not on curve");
			return {
				x,
				y
			};
		} else throw new Error(`bad point: got length ${length}, expected compressed=${comp} or uncompressed=${uncomp}`);
	}
	const encodePoint = extraOpts.toBytes === void 0 ? pointToBytes : extraOpts.toBytes;
	const decodePoint = extraOpts.fromBytes === void 0 ? pointFromBytes : extraOpts.fromBytes;
	function weierstrassEquation(x) {
		const x2 = Fp.sqr(x);
		const x3 = Fp.mul(x2, x);
		return Fp.add(Fp.add(x3, Fp.mul(x, CURVE.a)), CURVE.b);
	}
	/** Checks whether equation holds for given x, y: y² == x³ + ax + b */
	function isValidXY(x, y) {
		const left = Fp.sqr(y);
		const right = weierstrassEquation(x);
		return Fp.eql(left, right);
	}
	if (!isValidXY(CURVE.Gx, CURVE.Gy)) throw new Error("bad curve params: generator point");
	const _4a3 = Fp.mul(Fp.pow(CURVE.a, _3n), _4n);
	const _27b2 = Fp.mul(Fp.sqr(CURVE.b), BigInt(27));
	if (Fp.is0(Fp.add(_4a3, _27b2))) throw new Error("bad curve params: a or b");
	/** Asserts coordinate is valid: 0 <= n < Fp.ORDER. */
	function acoord(title, n, banZero = false) {
		if (!Fp.isValid(n) || banZero && Fp.is0(n)) throw new Error(`bad point coordinate ${title}`);
		return n;
	}
	function aprjpoint(other) {
		if (!(other instanceof Point)) throw new Error("Weierstrass Point expected");
	}
	function splitEndoScalarN(k) {
		if (!endo || !endo.basises) throw new Error("no endo");
		return _splitEndoScalar(k, endo.basises, Fn.ORDER);
	}
	function finishEndo(endoBeta, k1p, k2p, k1neg, k2neg) {
		k2p = new Point(Fp.mul(k2p.X, endoBeta), k2p.Y, k2p.Z);
		k1p = negateCt(k1neg, k1p);
		k2p = negateCt(k2neg, k2p);
		return k1p.add(k2p);
	}
	/**
	* Projective Point works in 3d / projective (homogeneous) coordinates:(X, Y, Z) ∋ (x=X/Z, y=Y/Z).
	* Default Point works in 2d / affine coordinates: (x, y).
	* We're doing calculations in projective, because its operations don't require costly inversion.
	*/
	class Point {
		static BASE = new Point(CURVE.Gx, CURVE.Gy, Fp.ONE);
		static ZERO = new Point(Fp.ZERO, Fp.ONE, Fp.ZERO);
		static Fp = Fp;
		static Fn = Fn;
		X;
		Y;
		Z;
		/** Does NOT validate if the point is valid. Use `.assertValidity()`. */
		constructor(X, Y, Z) {
			this.X = acoord("x", X);
			this.Y = acoord("y", Y, true);
			this.Z = acoord("z", Z);
			Object.freeze(this);
		}
		static CURVE() {
			return CURVE;
		}
		/** Does NOT validate if the point is valid. Use `.assertValidity()`. */
		static fromAffine(p) {
			const { x, y } = p || {};
			if (!p || !Fp.isValid(x) || !Fp.isValid(y)) throw new Error("invalid affine point");
			if (p instanceof Point) throw new Error("projective point not allowed");
			if (Fp.is0(x) && Fp.is0(y)) return Point.ZERO;
			return new Point(x, y, Fp.ONE);
		}
		static fromBytes(bytes) {
			const P = Point.fromAffine(decodePoint(abytes$1(bytes, void 0, "point")));
			P.assertValidity();
			return P;
		}
		static fromHex(hex) {
			return Point.fromBytes(hexToBytes(hex));
		}
		get x() {
			return this.toAffine().x;
		}
		get y() {
			return this.toAffine().y;
		}
		/**
		*
		* @param windowSize
		* @param isLazy - true will defer table computation until the first multiplication
		* @returns
		*/
		precompute(windowSize = 8, isLazy = true) {
			wnaf.createCache(this, windowSize);
			if (!isLazy) this.multiply(_3n);
			return this;
		}
		/** A point on curve is valid if it conforms to equation. */
		assertValidity() {
			const p = this;
			if (p.is0()) {
				if (extraOpts.allowInfinityPoint && Fp.is0(p.X) && Fp.eql(p.Y, Fp.ONE) && Fp.is0(p.Z)) return;
				throw new Error("bad point: ZERO");
			}
			const { x, y } = p.toAffine();
			if (!Fp.isValid(x) || !Fp.isValid(y)) throw new Error("bad point: x or y not field elements");
			if (!isValidXY(x, y)) throw new Error("bad point: equation left != right");
			if (!p.isTorsionFree()) throw new Error("bad point: not in prime-order subgroup");
		}
		hasEvenY() {
			const { y } = this.toAffine();
			if (!Fp.isOdd) throw new Error("Field doesn't support isOdd");
			return !Fp.isOdd(y);
		}
		/** Compare one point to another. */
		equals(other) {
			aprjpoint(other);
			const { X: X1, Y: Y1, Z: Z1 } = this;
			const { X: X2, Y: Y2, Z: Z2 } = other;
			const U1 = Fp.eql(Fp.mul(X1, Z2), Fp.mul(X2, Z1));
			const U2 = Fp.eql(Fp.mul(Y1, Z2), Fp.mul(Y2, Z1));
			return U1 && U2;
		}
		/** Flips point to one corresponding to (x, -y) in Affine coordinates. */
		negate() {
			return new Point(this.X, Fp.neg(this.Y), this.Z);
		}
		double() {
			const { a, b } = CURVE;
			const b3 = Fp.mul(b, _3n);
			const { X: X1, Y: Y1, Z: Z1 } = this;
			let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
			let t0 = Fp.mul(X1, X1);
			let t1 = Fp.mul(Y1, Y1);
			let t2 = Fp.mul(Z1, Z1);
			let t3 = Fp.mul(X1, Y1);
			t3 = Fp.add(t3, t3);
			Z3 = Fp.mul(X1, Z1);
			Z3 = Fp.add(Z3, Z3);
			X3 = Fp.mul(a, Z3);
			Y3 = Fp.mul(b3, t2);
			Y3 = Fp.add(X3, Y3);
			X3 = Fp.sub(t1, Y3);
			Y3 = Fp.add(t1, Y3);
			Y3 = Fp.mul(X3, Y3);
			X3 = Fp.mul(t3, X3);
			Z3 = Fp.mul(b3, Z3);
			t2 = Fp.mul(a, t2);
			t3 = Fp.sub(t0, t2);
			t3 = Fp.mul(a, t3);
			t3 = Fp.add(t3, Z3);
			Z3 = Fp.add(t0, t0);
			t0 = Fp.add(Z3, t0);
			t0 = Fp.add(t0, t2);
			t0 = Fp.mul(t0, t3);
			Y3 = Fp.add(Y3, t0);
			t2 = Fp.mul(Y1, Z1);
			t2 = Fp.add(t2, t2);
			t0 = Fp.mul(t2, t3);
			X3 = Fp.sub(X3, t0);
			Z3 = Fp.mul(t2, t1);
			Z3 = Fp.add(Z3, Z3);
			Z3 = Fp.add(Z3, Z3);
			return new Point(X3, Y3, Z3);
		}
		add(other) {
			aprjpoint(other);
			const { X: X1, Y: Y1, Z: Z1 } = this;
			const { X: X2, Y: Y2, Z: Z2 } = other;
			let X3 = Fp.ZERO, Y3 = Fp.ZERO, Z3 = Fp.ZERO;
			const a = CURVE.a;
			const b3 = Fp.mul(CURVE.b, _3n);
			let t0 = Fp.mul(X1, X2);
			let t1 = Fp.mul(Y1, Y2);
			let t2 = Fp.mul(Z1, Z2);
			let t3 = Fp.add(X1, Y1);
			let t4 = Fp.add(X2, Y2);
			t3 = Fp.mul(t3, t4);
			t4 = Fp.add(t0, t1);
			t3 = Fp.sub(t3, t4);
			t4 = Fp.add(X1, Z1);
			let t5 = Fp.add(X2, Z2);
			t4 = Fp.mul(t4, t5);
			t5 = Fp.add(t0, t2);
			t4 = Fp.sub(t4, t5);
			t5 = Fp.add(Y1, Z1);
			X3 = Fp.add(Y2, Z2);
			t5 = Fp.mul(t5, X3);
			X3 = Fp.add(t1, t2);
			t5 = Fp.sub(t5, X3);
			Z3 = Fp.mul(a, t4);
			X3 = Fp.mul(b3, t2);
			Z3 = Fp.add(X3, Z3);
			X3 = Fp.sub(t1, Z3);
			Z3 = Fp.add(t1, Z3);
			Y3 = Fp.mul(X3, Z3);
			t1 = Fp.add(t0, t0);
			t1 = Fp.add(t1, t0);
			t2 = Fp.mul(a, t2);
			t4 = Fp.mul(b3, t4);
			t1 = Fp.add(t1, t2);
			t2 = Fp.sub(t0, t2);
			t2 = Fp.mul(a, t2);
			t4 = Fp.add(t4, t2);
			t0 = Fp.mul(t1, t4);
			Y3 = Fp.add(Y3, t0);
			t0 = Fp.mul(t5, t4);
			X3 = Fp.mul(t3, X3);
			X3 = Fp.sub(X3, t0);
			t0 = Fp.mul(t3, t1);
			Z3 = Fp.mul(t5, Z3);
			Z3 = Fp.add(Z3, t0);
			return new Point(X3, Y3, Z3);
		}
		subtract(other) {
			aprjpoint(other);
			return this.add(other.negate());
		}
		is0() {
			return this.equals(Point.ZERO);
		}
		/**
		* Constant time multiplication.
		* Uses wNAF method. Windowed method may be 10% faster,
		* but takes 2x longer to generate and consumes 2x memory.
		* Uses precomputes when available.
		* Uses endomorphism for Koblitz curves.
		* @param scalar - by which the point would be multiplied
		* @returns New point
		*/
		multiply(scalar) {
			const { endo } = extraOpts;
			if (!Fn.isValidNot0(scalar)) throw new RangeError("invalid scalar: out of range");
			let point, fake;
			const mul = (n) => wnaf.cached(this, n, (p) => normalizeZ(Point, p));
			/** See docs for {@link EndomorphismOpts} */
			if (endo) {
				const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(scalar);
				const { p: k1p, f: k1f } = mul(k1);
				const { p: k2p, f: k2f } = mul(k2);
				fake = k1f.add(k2f);
				point = finishEndo(endo.beta, k1p, k2p, k1neg, k2neg);
			} else {
				const { p, f } = mul(scalar);
				point = p;
				fake = f;
			}
			return normalizeZ(Point, [point, fake])[0];
		}
		/**
		* Non-constant-time multiplication. Uses double-and-add algorithm.
		* It's faster, but should only be used when you don't care about
		* an exposed secret key e.g. sig verification, which works over *public* keys.
		*/
		multiplyUnsafe(scalar) {
			const { endo } = extraOpts;
			const p = this;
			const sc = scalar;
			if (!Fn.isValid(sc)) throw new RangeError("invalid scalar: out of range");
			if (sc === _0n$1 || p.is0()) return Point.ZERO;
			if (sc === _1n) return p;
			if (wnaf.hasCache(this)) return this.multiply(sc);
			if (endo) {
				const { k1neg, k1, k2neg, k2 } = splitEndoScalarN(sc);
				const { p1, p2 } = mulEndoUnsafe(Point, p, k1, k2);
				return finishEndo(endo.beta, p1, p2, k1neg, k2neg);
			} else return wnaf.unsafe(p, sc);
		}
		/**
		* Converts Projective point to affine (x, y) coordinates.
		* (X, Y, Z) ∋ (x=X/Z, y=Y/Z).
		* @param invertedZ - Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
		*/
		toAffine(invertedZ) {
			const p = this;
			let iz = invertedZ;
			const { X, Y, Z } = p;
			if (Fp.eql(Z, Fp.ONE)) return {
				x: X,
				y: Y
			};
			const is0 = p.is0();
			if (iz == null) iz = is0 ? Fp.ONE : Fp.inv(Z);
			const x = Fp.mul(X, iz);
			const y = Fp.mul(Y, iz);
			const zz = Fp.mul(Z, iz);
			if (is0) return {
				x: Fp.ZERO,
				y: Fp.ZERO
			};
			if (!Fp.eql(zz, Fp.ONE)) throw new Error("invZ was invalid");
			return {
				x,
				y
			};
		}
		/**
		* Checks whether Point is free of torsion elements (is in prime subgroup).
		* Always torsion-free for cofactor=1 curves.
		*/
		isTorsionFree() {
			const { isTorsionFree } = extraOpts;
			if (cofactor === _1n) return true;
			if (isTorsionFree) return isTorsionFree(Point, this);
			return wnaf.unsafe(this, CURVE_ORDER).is0();
		}
		clearCofactor() {
			const { clearCofactor } = extraOpts;
			if (cofactor === _1n) return this;
			if (clearCofactor) return clearCofactor(Point, this);
			return this.multiplyUnsafe(cofactor);
		}
		isSmallOrder() {
			if (cofactor === _1n) return this.is0();
			return this.clearCofactor().is0();
		}
		toBytes(isCompressed = true) {
			abool$1(isCompressed, "isCompressed");
			this.assertValidity();
			return encodePoint(Point, this, isCompressed);
		}
		toHex(isCompressed = true) {
			return bytesToHex(this.toBytes(isCompressed));
		}
		toString() {
			return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
		}
	}
	const bits = Fn.BITS;
	const wnaf = new wNAF(Point, extraOpts.endo ? Math.ceil(bits / 2) : bits);
	if (bits >= 8) Point.BASE.precompute(8);
	Object.freeze(Point.prototype);
	Object.freeze(Point);
	return Point;
}
function pprefix(hasEvenY) {
	return Uint8Array.of(hasEvenY ? 2 : 3);
}
function getWLengths(Fp, Fn) {
	return {
		secretKey: Fn.BYTES,
		publicKey: 1 + Fp.BYTES,
		publicKeyUncompressed: 1 + 2 * Fp.BYTES,
		publicKeyHasPrefix: true,
		signature: 2 * Fn.BYTES
	};
}
/**
* Sometimes users only need getPublicKey, getSharedSecret, and secret key handling.
* This helper ensures no signature functionality is present. Less code, smaller bundle size.
* @param Point - Weierstrass point constructor.
* @param ecdhOpts - Optional randomness helpers:
*   - `randomBytes` (optional): Optional RNG override.
* @returns ECDH helper namespace.
* @example
* Sometimes users only need getPublicKey, getSharedSecret, and secret key handling.
*
* ```ts
* import { ecdh } from '@noble/curves/abstract/weierstrass.js';
* import { p256 } from '@noble/curves/nist.js';
* const dh = ecdh(p256.Point);
* const alice = dh.keygen();
* const shared = dh.getSharedSecret(alice.secretKey, alice.publicKey);
* ```
*/
function ecdh(Point, ecdhOpts = {}) {
	const { Fn } = Point;
	const randomBytes_ = ecdhOpts.randomBytes === void 0 ? randomBytes : ecdhOpts.randomBytes;
	const lengths = Object.assign(getWLengths(Point.Fp, Fn), { seed: Math.max(getMinHashLength(Fn.ORDER), 16) });
	function isValidSecretKey(secretKey) {
		try {
			const num = Fn.fromBytes(secretKey);
			return Fn.isValidNot0(num);
		} catch (error) {
			return false;
		}
	}
	function isValidPublicKey(publicKey, isCompressed) {
		const { publicKey: comp, publicKeyUncompressed } = lengths;
		try {
			const l = publicKey.length;
			if (isCompressed === true && l !== comp) return false;
			if (isCompressed === false && l !== publicKeyUncompressed) return false;
			return !!Point.fromBytes(publicKey);
		} catch (error) {
			return false;
		}
	}
	/**
	* Produces cryptographically secure secret key from random of size
	* (groupLen + ceil(groupLen / 2)) with modulo bias being negligible.
	*/
	function randomSecretKey(seed) {
		seed = seed === void 0 ? randomBytes_(lengths.seed) : seed;
		return mapHashToField(abytes$1(seed, lengths.seed, "seed"), Fn.ORDER);
	}
	/**
	* Computes public key for a secret key. Checks for validity of the secret key.
	* @param isCompressed - whether to return compact (default), or full key
	* @returns Public key, full when isCompressed=false; short when isCompressed=true
	*/
	function getPublicKey(secretKey, isCompressed = true) {
		return Point.BASE.multiply(Fn.fromBytes(secretKey)).toBytes(isCompressed);
	}
	/**
	* Quick and dirty check for item being public key. Does not validate hex, or being on-curve.
	*/
	function isProbPub(item) {
		const { secretKey, publicKey, publicKeyUncompressed } = lengths;
		const allowedLengths = Fn._lengths;
		if (!isBytes$1(item)) return void 0;
		const l = abytes$1(item, void 0, "key").length;
		const isPub = l === publicKey || l === publicKeyUncompressed;
		const isSec = l === secretKey || !!allowedLengths?.includes(l);
		if (isPub && isSec) return void 0;
		return isPub;
	}
	/**
	* ECDH (Elliptic Curve Diffie Hellman).
	* Computes encoded shared point from secret key A and public key B.
	* Checks: 1) secret key validity 2) shared key is on-curve.
	* Does NOT hash the result or expose the SEC 1 x-coordinate-only `z`.
	* Returns the encoded shared point on purpose: callers that need `x_P`
	* can derive it from the encoded point, but `x_P` alone cannot recover the
	* point/parity back.
	* This helper only exposes the fully validated public-key path, not cofactor DH.
	* @param isCompressed - whether to return compact (default), or full key
	* @returns shared point encoding
	*/
	function getSharedSecret(secretKeyA, publicKeyB, isCompressed = true) {
		if (isProbPub(secretKeyA) === true) throw new Error("first arg must be private key");
		if (isProbPub(publicKeyB) === false) throw new Error("second arg must be public key");
		const s = Fn.fromBytes(secretKeyA);
		return Point.fromBytes(publicKeyB).multiply(s).toBytes(isCompressed);
	}
	const utils = {
		isValidSecretKey,
		isValidPublicKey,
		randomSecretKey
	};
	const keygen = createKeygen(randomSecretKey, getPublicKey);
	Object.freeze(utils);
	Object.freeze(lengths);
	return Object.freeze({
		getPublicKey,
		getSharedSecret,
		keygen,
		Point,
		utils,
		lengths
	});
}
/**
* Creates ECDSA signing interface for given elliptic curve `Point` and `hash` function.
*
* @param Point - created using {@link weierstrass} function
* @param hash - used for 1) message prehash-ing 2) k generation in `sign`, using hmac_drbg(hash)
* @param ecdsaOpts - rarely needed, see {@link ECDSAOpts}:
*   - `lowS`: Default low-S policy.
*   - `hmac`: HMAC implementation used by RFC6979 DRBG.
*   - `randomBytes`: Optional RNG override.
*   - `bits2int`: Optional hash-to-int conversion override.
*   - `bits2int_modN`: Optional hash-to-int-mod-n conversion override.
*
* @returns ECDSA helper namespace.
* @example
* Create an ECDSA signer/verifier bundle for one curve implementation.
*
* ```ts
* import { ecdsa } from '@noble/curves/abstract/weierstrass.js';
* import { p256 } from '@noble/curves/nist.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* const p256ecdsa = ecdsa(p256.Point, sha256);
* const { secretKey, publicKey } = p256ecdsa.keygen();
* const msg = new TextEncoder().encode('hello noble');
* const sig = p256ecdsa.sign(msg, secretKey);
* const isValid = p256ecdsa.verify(sig, msg, publicKey);
* ```
*/
function ecdsa(Point, hash, ecdsaOpts = {}) {
	const hash_ = hash;
	ahash(hash_);
	validateObject(ecdsaOpts, {}, {
		hmac: "function",
		lowS: "boolean",
		randomBytes: "function",
		bits2int: "function",
		bits2int_modN: "function"
	});
	ecdsaOpts = Object.assign({}, ecdsaOpts);
	const randomBytes$3 = ecdsaOpts.randomBytes === void 0 ? randomBytes : ecdsaOpts.randomBytes;
	const hmac$2 = ecdsaOpts.hmac === void 0 ? (key, msg) => hmac(hash_, key, msg) : ecdsaOpts.hmac;
	const { Fp, Fn } = Point;
	const { ORDER: CURVE_ORDER, BITS: fnBits } = Fn;
	const { keygen, getPublicKey, getSharedSecret, utils, lengths } = ecdh(Point, ecdsaOpts);
	const defaultSigOpts = {
		prehash: true,
		lowS: typeof ecdsaOpts.lowS === "boolean" ? ecdsaOpts.lowS : true,
		format: "compact",
		extraEntropy: false
	};
	const hasLargeRecoveryLifts = CURVE_ORDER * _2n$1 + _1n < Fp.ORDER;
	function isBiggerThanHalfOrder(number) {
		return number > CURVE_ORDER >> _1n;
	}
	function validateRS(title, num) {
		if (!Fn.isValidNot0(num)) throw new Error(`invalid signature ${title}: out of range 1..Point.Fn.ORDER`);
		return num;
	}
	function assertRecoverableCurve() {
		if (hasLargeRecoveryLifts) throw new Error("\"recovered\" sig type is not supported for cofactor >2 curves");
	}
	function validateSigLength(bytes, format) {
		validateSigFormat(format);
		const size = lengths.signature;
		return abytes$1(bytes, format === "compact" ? size : format === "recovered" ? size + 1 : void 0);
	}
	/**
	* ECDSA signature with its (r, s) properties. Supports compact, recovered & DER representations.
	*/
	class Signature {
		r;
		s;
		recovery;
		constructor(r, s, recovery) {
			this.r = validateRS("r", r);
			this.s = validateRS("s", s);
			if (recovery != null) {
				assertRecoverableCurve();
				if (![
					0,
					1,
					2,
					3
				].includes(recovery)) throw new Error("invalid recovery id");
				this.recovery = recovery;
			}
			Object.freeze(this);
		}
		static fromBytes(bytes, format = defaultSigOpts.format) {
			validateSigLength(bytes, format);
			let recid;
			if (format === "der") {
				const { r, s } = DER.toSig(abytes$1(bytes));
				return new Signature(r, s);
			}
			if (format === "recovered") {
				recid = bytes[0];
				format = "compact";
				bytes = bytes.subarray(1);
			}
			const L = lengths.signature / 2;
			const r = bytes.subarray(0, L);
			const s = bytes.subarray(L, L * 2);
			return new Signature(Fn.fromBytes(r), Fn.fromBytes(s), recid);
		}
		static fromHex(hex, format) {
			return this.fromBytes(hexToBytes(hex), format);
		}
		assertRecovery() {
			const { recovery } = this;
			if (recovery == null) throw new Error("invalid recovery id: must be present");
			return recovery;
		}
		addRecoveryBit(recovery) {
			return new Signature(this.r, this.s, recovery);
		}
		recoverPublicKey(messageHash) {
			const { r, s } = this;
			const recovery = this.assertRecovery();
			const radj = recovery === 2 || recovery === 3 ? r + CURVE_ORDER : r;
			if (!Fp.isValid(radj)) throw new Error("invalid recovery id: sig.r+curve.n != R.x");
			const x = Fp.toBytes(radj);
			const R = Point.fromBytes(concatBytes(pprefix((recovery & 1) === 0), x));
			const ir = Fn.inv(radj);
			const h = bits2int_modN(abytes$1(messageHash, void 0, "msgHash"));
			const u1 = Fn.create(-h * ir);
			const u2 = Fn.create(s * ir);
			const Q = Point.BASE.multiplyUnsafe(u1).add(R.multiplyUnsafe(u2));
			if (Q.is0()) throw new Error("invalid recovery: point at infinify");
			Q.assertValidity();
			return Q;
		}
		hasHighS() {
			return isBiggerThanHalfOrder(this.s);
		}
		toBytes(format = defaultSigOpts.format) {
			validateSigFormat(format);
			if (format === "der") return hexToBytes(DER.hexFromSig(this));
			const { r, s } = this;
			const rb = Fn.toBytes(r);
			const sb = Fn.toBytes(s);
			if (format === "recovered") {
				assertRecoverableCurve();
				return concatBytes(Uint8Array.of(this.assertRecovery()), rb, sb);
			}
			return concatBytes(rb, sb);
		}
		toHex(format) {
			return bytesToHex(this.toBytes(format));
		}
	}
	Object.freeze(Signature.prototype);
	Object.freeze(Signature);
	const bits2int = ecdsaOpts.bits2int === void 0 ? function bits2int_def(bytes) {
		if (bytes.length > 8192) throw new Error("input is too large");
		const num = bytesToNumberBE(bytes);
		const delta = bytes.length * 8 - fnBits;
		return delta > 0 ? num >> BigInt(delta) : num;
	} : ecdsaOpts.bits2int;
	const bits2int_modN = ecdsaOpts.bits2int_modN === void 0 ? function bits2int_modN_def(bytes) {
		return Fn.create(bits2int(bytes));
	} : ecdsaOpts.bits2int_modN;
	const ORDER_MASK = bitMask(fnBits);
	/** Converts to bytes. Checks if num in `[0..ORDER_MASK-1]` e.g.: `[0..2^256-1]`. */
	function int2octets(num) {
		aInRange("num < 2^" + fnBits, num, _0n$1, ORDER_MASK);
		return Fn.toBytes(num);
	}
	function validateMsgAndHash(message, prehash) {
		abytes$1(message, void 0, "message");
		return prehash ? abytes$1(hash_(message), void 0, "prehashed message") : message;
	}
	/**
	* Steps A, D of RFC6979 3.2.
	* Creates RFC6979 seed; converts msg/privKey to numbers.
	* Used only in sign, not in verify.
	*
	* Warning: we cannot assume here that message has same amount of bytes as curve order,
	* this will be invalid at least for P521. Also it can be bigger for P224 + SHA256.
	*/
	function prepSig(message, secretKey, opts) {
		const { lowS, prehash, extraEntropy } = validateSigOpts(opts, defaultSigOpts);
		message = validateMsgAndHash(message, prehash);
		const h1int = bits2int_modN(message);
		const d = Fn.fromBytes(secretKey);
		if (!Fn.isValidNot0(d)) throw new Error("invalid private key");
		const seedArgs = [int2octets(d), int2octets(h1int)];
		if (extraEntropy != null && extraEntropy !== false) {
			const e = extraEntropy === true ? randomBytes$3(lengths.secretKey) : extraEntropy;
			seedArgs.push(abytes$1(e, void 0, "extraEntropy"));
		}
		const seed = concatBytes(...seedArgs);
		const m = h1int;
		function k2sig(kBytes) {
			const k = bits2int(kBytes);
			if (!Fn.isValidNot0(k)) return;
			const ik = Fn.inv(k);
			const q = Point.BASE.multiply(k).toAffine();
			const r = Fn.create(q.x);
			if (r === _0n$1) return;
			const s = Fn.create(ik * Fn.create(m + r * d));
			if (s === _0n$1) return;
			let recovery = (q.x === r ? 0 : 2) | Number(q.y & _1n);
			let normS = s;
			if (lowS && isBiggerThanHalfOrder(s)) {
				normS = Fn.neg(s);
				recovery ^= 1;
			}
			return new Signature(r, normS, hasLargeRecoveryLifts ? void 0 : recovery);
		}
		return {
			seed,
			k2sig
		};
	}
	/**
	* Signs a message or message hash with a secret key.
	* With the default `prehash: true`, raw message bytes are hashed internally;
	* only `{ prehash: false }` expects a caller-supplied digest.
	*
	* ```
	* sign(m, d) where
	*   k = rfc6979_hmac_drbg(m, d)
	*   (x, y) = G × k
	*   r = x mod n
	*   s = (m + dr) / k mod n
	* ```
	*/
	function sign(message, secretKey, opts = {}) {
		const { seed, k2sig } = prepSig(message, secretKey, opts);
		return createHmacDrbg(hash_.outputLen, Fn.BYTES, hmac$2)(seed, k2sig).toBytes(opts.format);
	}
	/**
	* Verifies a signature against message and public key.
	* Rejects lowS signatures by default: see {@link ECDSAVerifyOpts}.
	* Implements section 4.1.4 from https://www.secg.org/sec1-v2.pdf:
	*
	* ```
	* verify(r, s, h, P) where
	*   u1 = hs^-1 mod n
	*   u2 = rs^-1 mod n
	*   R = u1⋅G + u2⋅P
	*   mod(R.x, n) == r
	* ```
	*/
	function verify(signature, message, publicKey, opts = {}) {
		const { lowS, prehash, format } = validateSigOpts(opts, defaultSigOpts);
		publicKey = abytes$1(publicKey, void 0, "publicKey");
		message = validateMsgAndHash(message, prehash);
		if (!isBytes$1(signature)) {
			const end = signature instanceof Signature ? ", use sig.toBytes()" : "";
			throw new Error("verify expects Uint8Array signature" + end);
		}
		validateSigLength(signature, format);
		try {
			const sig = Signature.fromBytes(signature, format);
			const P = Point.fromBytes(publicKey);
			if (lowS && sig.hasHighS()) return false;
			const { r, s } = sig;
			const h = bits2int_modN(message);
			const is = Fn.inv(s);
			const u1 = Fn.create(h * is);
			const u2 = Fn.create(r * is);
			const R = Point.BASE.multiplyUnsafe(u1).add(P.multiplyUnsafe(u2));
			if (R.is0()) return false;
			return Fn.create(R.x) === r;
		} catch (e) {
			return false;
		}
	}
	function recoverPublicKey(signature, message, opts = {}) {
		const { prehash } = validateSigOpts(opts, defaultSigOpts);
		message = validateMsgAndHash(message, prehash);
		return Signature.fromBytes(signature, "recovered").recoverPublicKey(message).toBytes();
	}
	return Object.freeze({
		keygen,
		getPublicKey,
		getSharedSecret,
		utils,
		lengths,
		Point,
		sign,
		verify,
		recoverPublicKey,
		Signature,
		hash: hash_
	});
}
//#endregion
//#region node_modules/@noble/curves/secp256k1.js
/**
* SECG secp256k1. See [pdf](https://www.secg.org/sec2-v2.pdf).
*
* Belongs to Koblitz curves: it has efficiently-computable GLV endomorphism ψ,
* check out {@link EndomorphismOpts}. Seems to be rigid (not backdoored).
* @module
*/
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const secp256k1_CURVE = {
	p: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"),
	n: BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
	h: BigInt(1),
	a: BigInt(0),
	b: BigInt(7),
	Gx: BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
	Gy: BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8")
};
const secp256k1_ENDO = {
	beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
	basises: [[BigInt("0x3086d221a7d46bcde86c90e49284eb15"), -BigInt("0xe4437ed6010e88286f547fa90abfe4c3")], [BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8"), BigInt("0x3086d221a7d46bcde86c90e49284eb15")]]
};
const _0n = /* @__PURE__ */ BigInt(0);
const _2n = /* @__PURE__ */ BigInt(2);
/**
* √n = n^((p+1)/4) for fields p = 3 mod 4. We unwrap the loop and multiply bit-by-bit.
* (P+1n/4n).toString(2) would produce bits [223x 1, 0, 22x 1, 4x 0, 11, 00]
*/
function sqrtMod(y) {
	const P = secp256k1_CURVE.p;
	const _3n = BigInt(3), _6n = BigInt(6), _11n = BigInt(11), _22n = BigInt(22);
	const _23n = BigInt(23), _44n = BigInt(44), _88n = BigInt(88);
	const b2 = y * y * y % P;
	const b3 = b2 * b2 * y % P;
	const b11 = pow2(pow2(pow2(b3, _3n, P) * b3 % P, _3n, P) * b3 % P, _2n, P) * b2 % P;
	const b22 = pow2(b11, _11n, P) * b11 % P;
	const b44 = pow2(b22, _22n, P) * b22 % P;
	const b88 = pow2(b44, _44n, P) * b44 % P;
	const root = pow2(pow2(pow2(pow2(pow2(pow2(b88, _88n, P) * b88 % P, _44n, P) * b44 % P, _3n, P) * b3 % P, _23n, P) * b22 % P, _6n, P) * b2 % P, _2n, P);
	if (!Fpk1.eql(Fpk1.sqr(root), y)) throw new Error("Cannot find square root");
	return root;
}
const Fpk1 = Field(secp256k1_CURVE.p, { sqrt: sqrtMod });
const Pointk1 = /* @__PURE__ */ weierstrass(secp256k1_CURVE, {
	Fp: Fpk1,
	endo: secp256k1_ENDO
});
/**
* secp256k1 curve: ECDSA and ECDH methods.
*
* Uses sha256 to hash messages. To use a different hash,
* pass `{ prehash: false }` to sign / verify.
*
* @example
* Generate one secp256k1 keypair, sign a message, and verify it.
*
* ```js
* import { secp256k1 } from '@noble/curves/secp256k1.js';
* const { secretKey, publicKey } = secp256k1.keygen();
* // const publicKey = secp256k1.getPublicKey(secretKey);
* const msg = new TextEncoder().encode('hello noble');
* const sig = secp256k1.sign(msg, secretKey);
* const isValid = secp256k1.verify(sig, msg, publicKey);
* // const sigKeccak = secp256k1.sign(keccak256(msg), secretKey, { prehash: false });
* ```
*/
const secp256k1 = /* @__PURE__ */ ecdsa(Pointk1, sha256);
/** An object mapping tags to their tagged hash prefix of [SHA256(tag) | SHA256(tag)] */
const TAGGED_HASH_PREFIXES = {};
function taggedHash(tag, ...messages) {
	let tagP = TAGGED_HASH_PREFIXES[tag];
	if (tagP === void 0) {
		const tagH = sha256(asciiToBytes(tag));
		tagP = concatBytes(tagH, tagH);
		TAGGED_HASH_PREFIXES[tag] = tagP;
	}
	return sha256(concatBytes(tagP, ...messages));
}
const pointToBytes = (point) => point.toBytes(true).slice(1);
const hasEven = (y) => y % _2n === _0n;
function schnorrGetExtPubKey(priv) {
	const { Fn, BASE } = Pointk1;
	const d_ = Fn.fromBytes(priv);
	const p = BASE.multiply(d_);
	return {
		scalar: hasEven(p.y) ? d_ : Fn.neg(d_),
		bytes: pointToBytes(p)
	};
}
/**
* lift_x from BIP340. Convert 32-byte x coordinate to elliptic curve point.
* @returns valid point checked for being on-curve
*/
function lift_x(x) {
	const Fp = Fpk1;
	if (!Fp.isValidNot0(x)) throw new Error("invalid x: Fail if x ≥ p");
	const xx = Fp.create(x * x);
	const c = Fp.create(xx * x + BigInt(7));
	let y = Fp.sqrt(c);
	if (!hasEven(y)) y = Fp.neg(y);
	const p = Pointk1.fromAffine({
		x,
		y
	});
	p.assertValidity();
	return p;
}
const num = bytesToNumberBE;
/** Create tagged hash, convert it to bigint, reduce modulo-n. */
function challenge(...args) {
	return Pointk1.Fn.create(num(taggedHash("BIP0340/challenge", ...args)));
}
/** Schnorr public key is just `x` coordinate of Point as per BIP340. */
function schnorrGetPublicKey(secretKey) {
	return schnorrGetExtPubKey(secretKey).bytes;
}
/**
* Creates Schnorr signature as per BIP340. Verifies itself before returning anything.
* `auxRand` is optional and is not the sole source of `k` generation: bad CSPRNG output will not
* be catastrophic, but BIP-340 still recommends fresh auxiliary randomness when available to harden
* deterministic signing against side-channel and fault-injection attacks.
*/
function schnorrSign(message, secretKey, auxRand = randomBytes$1(32)) {
	const { Fn, BASE } = Pointk1;
	const m = abytes$1(message, void 0, "message");
	const { bytes: px, scalar: d } = schnorrGetExtPubKey(secretKey);
	const a = abytes$1(auxRand, 32, "auxRand");
	const rand = taggedHash("BIP0340/nonce", Fn.toBytes(d ^ num(taggedHash("BIP0340/aux", a))), px, m);
	const k_ = Fn.create(num(rand));
	if (k_ === 0n) throw new Error("sign failed: k is zero");
	const p = BASE.multiply(k_);
	const k = hasEven(p.y) ? k_ : Fn.neg(k_);
	const rx = pointToBytes(p);
	const e = challenge(rx, px, m);
	const sig = new Uint8Array(64);
	sig.set(rx, 0);
	sig.set(Fn.toBytes(Fn.create(k + e * d)), 32);
	if (!schnorrVerify(sig, m, px)) throw new Error("sign: Invalid signature produced");
	return sig;
}
/**
* Verifies Schnorr signature.
* Will swallow errors & return false except for initial type validation of arguments.
*/
function schnorrVerify(signature, message, publicKey) {
	const { Fp, Fn, BASE } = Pointk1;
	const sig = abytes$1(signature, 64, "signature");
	const m = abytes$1(message, void 0, "message");
	const pub = abytes$1(publicKey, 32, "publicKey");
	try {
		const P = lift_x(num(pub));
		const r = num(sig.subarray(0, 32));
		if (!Fp.isValidNot0(r)) return false;
		const s = num(sig.subarray(32, 64));
		if (!Fn.isValidNot0(s)) return false;
		const e = challenge(Fn.toBytes(r), pointToBytes(P), m);
		const R = BASE.multiplyUnsafe(s).add(P.multiplyUnsafe(Fn.neg(e)));
		const { x, y } = R.toAffine();
		if (R.is0() || !hasEven(y) || x !== r) return false;
		return true;
	} catch (error) {
		return false;
	}
}
/**
* Schnorr signatures over secp256k1.
* See {@link https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki | BIP 340}.
* @example
* Generate one BIP340 Schnorr keypair, sign a message, and verify it.
*
* ```js
* import { schnorr } from '@noble/curves/secp256k1.js';
* const { secretKey, publicKey } = schnorr.keygen();
* // const publicKey = schnorr.getPublicKey(secretKey);
* const msg = new TextEncoder().encode('hello');
* const sig = schnorr.sign(msg, secretKey);
* const isValid = schnorr.verify(sig, msg, publicKey);
* ```
*/
const schnorr = /* @__PURE__ */ (() => {
	const size = 32;
	const seedLength = 48;
	const randomSecretKey = (seed) => {
		seed = seed === void 0 ? randomBytes$1(seedLength) : seed;
		return mapHashToField(seed, secp256k1_CURVE.n);
	};
	return Object.freeze({
		keygen: createKeygen(randomSecretKey, schnorrGetPublicKey),
		getPublicKey: schnorrGetPublicKey,
		sign: schnorrSign,
		verify: schnorrVerify,
		Point: Pointk1,
		utils: Object.freeze({
			randomSecretKey,
			taggedHash,
			lift_x,
			pointToBytes
		}),
		lengths: Object.freeze({
			secretKey: size,
			publicKey: size,
			publicKeyHasPrefix: false,
			signature: size * 2,
			seed: seedLength
		})
	});
})();
//#endregion
//#region node_modules/@noble/hashes/hkdf.js
/**
* HKDF (RFC 5869): extract + expand in one step.
* See {@link https://soatok.blog/2021/11/17/understanding-hkdf/}.
* @module
*/
/**
* HKDF-extract from spec. Less important part. `HKDF-Extract(IKM, salt) -> PRK`
* Arguments position differs from spec (IKM is first one, since it is not optional)
* Local validation only checks `hash`; `ikm` / `salt` byte validation is delegated to `hmac()`.
* @param hash - hash function that would be used (e.g. sha256)
* @param ikm - input keying material, the initial key
* @param salt - optional salt value (a non-secret random value)
* @returns Pseudorandom key derived from input keying material.
* @example
* Run the HKDF extract step.
* ```ts
* import { extract } from '@noble/hashes/hkdf.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* extract(sha256, new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6]));
* ```
*/
function extract$1(hash, ikm, salt) {
	ahash(hash);
	if (salt === void 0) salt = new Uint8Array(hash.outputLen);
	return hmac(hash, salt, ikm);
}
const HKDF_COUNTER$1 = /* @__PURE__ */ Uint8Array.of(0);
const EMPTY_BUFFER$1 = /* @__PURE__ */ Uint8Array.of();
/**
* HKDF-expand from the spec. The most important part. `HKDF-Expand(PRK, info, L) -> OKM`
* @param hash - hash function that would be used (e.g. sha256)
* @param prk - a pseudorandom key of at least HashLen octets
*   (usually, the output from the extract step)
* @param info - optional context and application specific information (can be a zero-length string)
* @param length - length of output keying material in bytes.
*   RFC 5869 §2.3 allows `0..255*HashLen`, so `0` returns an empty OKM.
* @returns Output keying material with the requested length.
* @throws If the requested output length exceeds the HKDF limit
*   for the selected hash. {@link Error}
* @example
* Run the HKDF expand step.
* ```ts
* import { expand } from '@noble/hashes/hkdf.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* expand(sha256, new Uint8Array(32), new Uint8Array([1, 2, 3]), 16);
* ```
*/
function expand$1(hash, prk, info, length = 32) {
	ahash(hash);
	anumber$2(length, "length");
	abytes$2(prk, void 0, "prk");
	const olen = hash.outputLen;
	if (prk.length < olen) throw new Error("\"prk\" must be at least HashLen octets");
	if (length > 255 * olen) throw new Error("Length must be <= 255*HashLen");
	const blocks = Math.ceil(length / olen);
	if (info === void 0) info = EMPTY_BUFFER$1;
	else abytes$2(info, void 0, "info");
	const okm = new Uint8Array(blocks * olen);
	const HMAC = hmac.create(hash, prk);
	const HMACTmp = HMAC._cloneInto();
	const T = new Uint8Array(HMAC.outputLen);
	for (let counter = 0; counter < blocks; counter++) {
		HKDF_COUNTER$1[0] = counter + 1;
		HMACTmp.update(counter === 0 ? EMPTY_BUFFER$1 : T).update(info).update(HKDF_COUNTER$1).digestInto(T);
		okm.set(T, olen * counter);
		HMAC._cloneInto(HMACTmp);
	}
	HMAC.destroy();
	HMACTmp.destroy();
	clean$1(T, HKDF_COUNTER$1);
	return okm.slice(0, length);
}
/**
* HKDF (RFC 5869): derive keys from an initial input.
* Combines hkdf_extract + hkdf_expand in one step
* @param hash - hash function that would be used (e.g. sha256)
* @param ikm - input keying material, the initial key
* @param salt - optional salt value (a non-secret random value)
* @param info - optional context and application specific information bytes
* @param length - length of output keying material in bytes.
*   RFC 5869 §2.3 allows `0..255*HashLen`, so `0` returns an empty OKM.
* @returns Output keying material derived from the input key.
* @throws If the requested output length exceeds the HKDF limit
*   for the selected hash. {@link Error}
* @example
* HKDF (RFC 5869): derive keys from an initial input.
* ```ts
* import { hkdf } from '@noble/hashes/hkdf.js';
* import { sha256 } from '@noble/hashes/sha2.js';
* import { randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
* const inputKey = randomBytes(32);
* const salt = randomBytes(32);
* const info = utf8ToBytes('application-key');
* const okm = hkdf(sha256, inputKey, salt, info, 32);
* ```
*/
const hkdf = (hash, ikm, salt, info, length) => expand$1(hash, extract$1(hash, ikm, salt), info, length);
//#endregion
//#region node_modules/@noble/ciphers/utils.js
/**
* Utilities for hex, bytes, CSPRNG.
* @module
*/
/*! noble-ciphers - MIT License (c) 2023 Paul Miller (paulmillr.com) */
/** Checks if something is Uint8Array. Be careful: nodejs Buffer will return true. */
function isBytes(a) {
	return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
/** Asserts something is boolean. */
function abool(b) {
	if (typeof b !== "boolean") throw new Error(`boolean expected, not ${b}`);
}
/** Asserts something is positive integer. */
function anumber(n) {
	if (!Number.isSafeInteger(n) || n < 0) throw new Error("positive integer expected, got " + n);
}
/** Asserts something is Uint8Array. */
function abytes(value, length, title = "") {
	const bytes = isBytes(value);
	const len = value?.length;
	const needsLen = length !== void 0;
	if (!bytes || needsLen && len !== length) {
		const prefix = title && `"${title}" `;
		const ofLen = needsLen ? ` of length ${length}` : "";
		const got = bytes ? `length=${len}` : `type=${typeof value}`;
		throw new Error(prefix + "expected Uint8Array" + ofLen + ", got " + got);
	}
	return value;
}
/** Asserts a hash instance has not been destroyed / finished */
function aexists(instance, checkFinished = true) {
	if (instance.destroyed) throw new Error("Hash instance has been destroyed");
	if (checkFinished && instance.finished) throw new Error("Hash#digest() has already been called");
}
/** Asserts output is properly-sized byte array */
function aoutput(out, instance) {
	abytes(out, void 0, "output");
	const min = instance.outputLen;
	if (out.length < min) throw new Error("digestInto() expects output buffer of length at least " + min);
}
/** Cast u8 / u16 / u32 to u32. */
function u32(arr) {
	return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
/** Zeroize a byte array. Warning: JS provides no guarantees. */
function clean(...arrays) {
	for (let i = 0; i < arrays.length; i++) arrays[i].fill(0);
}
/** Is current platform little-endian? Most are. Big-Endian platform: IBM */
const isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
/**
* Checks if two U8A use same underlying buffer and overlaps.
* This is invalid and can corrupt data.
*/
function overlapBytes(a, b) {
	return a.buffer === b.buffer && a.byteOffset < b.byteOffset + b.byteLength && b.byteOffset < a.byteOffset + a.byteLength;
}
/**
* If input and output overlap and input starts before output, we will overwrite end of input before
* we start processing it, so this is not supported for most ciphers (except chacha/salse, which designed with this)
*/
function complexOverlapBytes(input, output) {
	if (overlapBytes(input, output) && input.byteOffset < output.byteOffset) throw new Error("complex overlap of input and output is not supported");
}
function checkOpts(defaults, opts) {
	if (opts == null || typeof opts !== "object") throw new Error("options must be defined");
	return Object.assign(defaults, opts);
}
/** Compares 2 uint8array-s in kinda constant time. */
function equalBytes(a, b) {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
	return diff === 0;
}
/**
* Wraps a cipher: validates args, ensures encrypt() can only be called once.
* @__NO_SIDE_EFFECTS__
*/
const wrapCipher = (params, constructor) => {
	function wrappedCipher(key, ...args) {
		abytes(key, void 0, "key");
		if (!isLE) throw new Error("Non little-endian hardware is not yet supported");
		if (params.nonceLength !== void 0) {
			const nonce = args[0];
			abytes(nonce, params.varSizeNonce ? void 0 : params.nonceLength, "nonce");
		}
		const tagl = params.tagLength;
		if (tagl && args[1] !== void 0) abytes(args[1], void 0, "AAD");
		const cipher = constructor(key, ...args);
		const checkOutput = (fnLength, output) => {
			if (output !== void 0) {
				if (fnLength !== 2) throw new Error("cipher output not supported");
				abytes(output, void 0, "output");
			}
		};
		let called = false;
		return {
			encrypt(data, output) {
				if (called) throw new Error("cannot encrypt() twice with same key + nonce");
				called = true;
				abytes(data);
				checkOutput(cipher.encrypt.length, output);
				return cipher.encrypt(data, output);
			},
			decrypt(data, output) {
				abytes(data);
				if (tagl && data.length < tagl) throw new Error("\"ciphertext\" expected length bigger than tagLength=" + tagl);
				checkOutput(cipher.decrypt.length, output);
				return cipher.decrypt(data, output);
			}
		};
	}
	Object.assign(wrappedCipher, params);
	return wrappedCipher;
};
/**
* By default, returns u8a of length.
* When out is available, it checks it for validity and uses it.
*/
function getOutput(expectedLength, out, onlyAligned = true) {
	if (out === void 0) return new Uint8Array(expectedLength);
	if (out.length !== expectedLength) throw new Error("\"output\" expected Uint8Array of length " + expectedLength + ", got: " + out.length);
	if (onlyAligned && !isAligned32$1(out)) throw new Error("invalid output, must be aligned");
	return out;
}
function isAligned32$1(bytes) {
	return bytes.byteOffset % 4 === 0;
}
function copyBytes(bytes) {
	return Uint8Array.from(bytes);
}
//#endregion
//#region node_modules/@noble/ciphers/_arx.js
/**
* Basic utils for ARX (add-rotate-xor) salsa and chacha ciphers.

RFC8439 requires multi-step cipher stream, where
authKey starts with counter: 0, actual msg with counter: 1.

For this, we need a way to re-use nonce / counter:

const counter = new Uint8Array(4);
chacha(..., counter, ...); // counter is now 1
chacha(..., counter, ...); // counter is now 2

This is complicated:

- 32-bit counters are enough, no need for 64-bit: max ArrayBuffer size in JS is 4GB
- Original papers don't allow mutating counters
- Counter overflow is undefined [^1]
- Idea A: allow providing (nonce | counter) instead of just nonce, re-use it
- Caveat: Cannot be re-used through all cases:
- * chacha has (counter | nonce)
- * xchacha has (nonce16 | counter | nonce16)
- Idea B: separate nonce / counter and provide separate API for counter re-use
- Caveat: there are different counter sizes depending on an algorithm.
- salsa & chacha also differ in structures of key & sigma:
salsa20:      s[0] | k(4) | s[1] | nonce(2) | cnt(2) | s[2] | k(4) | s[3]
chacha:       s(4) | k(8) | cnt(1) | nonce(3)
chacha20orig: s(4) | k(8) | cnt(2) | nonce(2)
- Idea C: helper method such as `setSalsaState(key, nonce, sigma, data)`
- Caveat: we can't re-use counter array

xchacha [^2] uses the subkey and remaining 8 byte nonce with ChaCha20 as normal
(prefixed by 4 NUL bytes, since [RFC8439] specifies a 12-byte nonce).

[^1]: https://mailarchive.ietf.org/arch/msg/cfrg/gsOnTJzcbgG6OqD8Sc0GO5aR_tU/
[^2]: https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-xchacha#appendix-A.2

* @module
*/
const encodeStr = (str) => Uint8Array.from(str.split(""), (c) => c.charCodeAt(0));
const sigma16 = encodeStr("expand 16-byte k");
const sigma32 = encodeStr("expand 32-byte k");
const sigma16_32 = u32(sigma16);
const sigma32_32 = u32(sigma32);
/** Rotate left. */
function rotl(a, b) {
	return a << b | a >>> 32 - b;
}
function isAligned32(b) {
	return b.byteOffset % 4 === 0;
}
const BLOCK_LEN = 64;
const BLOCK_LEN32 = 16;
const MAX_COUNTER = 2 ** 32 - 1;
const U32_EMPTY = Uint32Array.of();
function runCipher(core, sigma, key, nonce, data, output, counter, rounds) {
	const len = data.length;
	const block = new Uint8Array(BLOCK_LEN);
	const b32 = u32(block);
	const isAligned = isAligned32(data) && isAligned32(output);
	const d32 = isAligned ? u32(data) : U32_EMPTY;
	const o32 = isAligned ? u32(output) : U32_EMPTY;
	for (let pos = 0; pos < len; counter++) {
		core(sigma, key, nonce, b32, counter, rounds);
		if (counter >= MAX_COUNTER) throw new Error("arx: counter overflow");
		const take = Math.min(BLOCK_LEN, len - pos);
		if (isAligned && take === BLOCK_LEN) {
			const pos32 = pos / 4;
			if (pos % 4 !== 0) throw new Error("arx: invalid block position");
			for (let j = 0, posj; j < BLOCK_LEN32; j++) {
				posj = pos32 + j;
				o32[posj] = d32[posj] ^ b32[j];
			}
			pos += BLOCK_LEN;
			continue;
		}
		for (let j = 0, posj; j < take; j++) {
			posj = pos + j;
			output[posj] = data[posj] ^ block[j];
		}
		pos += take;
	}
}
/** Creates ARX-like (ChaCha, Salsa) cipher stream from core function. */
function createCipher(core, opts) {
	const { allowShortKeys, extendNonceFn, counterLength, counterRight, rounds } = checkOpts({
		allowShortKeys: false,
		counterLength: 8,
		counterRight: false,
		rounds: 20
	}, opts);
	if (typeof core !== "function") throw new Error("core must be a function");
	anumber(counterLength);
	anumber(rounds);
	abool(counterRight);
	abool(allowShortKeys);
	return (key, nonce, data, output, counter = 0) => {
		abytes(key, void 0, "key");
		abytes(nonce, void 0, "nonce");
		abytes(data, void 0, "data");
		const len = data.length;
		if (output === void 0) output = new Uint8Array(len);
		abytes(output, void 0, "output");
		anumber(counter);
		if (counter < 0 || counter >= MAX_COUNTER) throw new Error("arx: counter overflow");
		if (output.length < len) throw new Error(`arx: output (${output.length}) is shorter than data (${len})`);
		const toClean = [];
		let l = key.length;
		let k;
		let sigma;
		if (l === 32) {
			toClean.push(k = copyBytes(key));
			sigma = sigma32_32;
		} else if (l === 16 && allowShortKeys) {
			k = new Uint8Array(32);
			k.set(key);
			k.set(key, 16);
			sigma = sigma16_32;
			toClean.push(k);
		} else {
			abytes(key, 32, "arx key");
			throw new Error("invalid key size");
		}
		if (!isAligned32(nonce)) toClean.push(nonce = copyBytes(nonce));
		const k32 = u32(k);
		if (extendNonceFn) {
			if (nonce.length !== 24) throw new Error(`arx: extended nonce must be 24 bytes`);
			extendNonceFn(sigma, k32, u32(nonce.subarray(0, 16)), k32);
			nonce = nonce.subarray(16);
		}
		const nonceNcLen = 16 - counterLength;
		if (nonceNcLen !== nonce.length) throw new Error(`arx: nonce must be ${nonceNcLen} or 16 bytes`);
		if (nonceNcLen !== 12) {
			const nc = new Uint8Array(12);
			nc.set(nonce, counterRight ? 0 : 12 - nonce.length);
			nonce = nc;
			toClean.push(nonce);
		}
		const n32 = u32(nonce);
		runCipher(core, sigma, k32, n32, data, output, counter, rounds);
		clean(...toClean);
		return output;
	};
}
//#endregion
//#region node_modules/@noble/ciphers/_poly1305.js
/**
* Poly1305 ([PDF](https://cr.yp.to/mac/poly1305-20050329.pdf),
* [wiki](https://en.wikipedia.org/wiki/Poly1305))
* is a fast and parallel secret-key message-authentication code suitable for
* a wide variety of applications. It was standardized in
* [RFC 8439](https://www.rfc-editor.org/rfc/rfc8439) and is now used in TLS 1.3.
*
* Polynomial MACs are not perfect for every situation:
* they lack Random Key Robustness: the MAC can be forged, and can't be used in PAKE schemes.
* See [invisible salamanders attack](https://keymaterial.net/2020/09/07/invisible-salamanders-in-aes-gcm-siv/).
* To combat invisible salamanders, `hash(key)` can be included in ciphertext,
* however, this would violate ciphertext indistinguishability:
* an attacker would know which key was used - so `HKDF(key, i)`
* could be used instead.
*
* Check out [original website](https://cr.yp.to/mac.html).
* Based on Public Domain [poly1305-donna](https://github.com/floodyberry/poly1305-donna).
* @module
*/
function u8to16(a, i) {
	return a[i++] & 255 | (a[i++] & 255) << 8;
}
/** Poly1305 class. Prefer poly1305() function instead. */
var Poly1305 = class {
	blockLen = 16;
	outputLen = 16;
	buffer = new Uint8Array(16);
	r = new Uint16Array(10);
	h = new Uint16Array(10);
	pad = new Uint16Array(8);
	pos = 0;
	finished = false;
	constructor(key) {
		key = copyBytes(abytes(key, 32, "key"));
		const t0 = u8to16(key, 0);
		const t1 = u8to16(key, 2);
		const t2 = u8to16(key, 4);
		const t3 = u8to16(key, 6);
		const t4 = u8to16(key, 8);
		const t5 = u8to16(key, 10);
		const t6 = u8to16(key, 12);
		const t7 = u8to16(key, 14);
		this.r[0] = t0 & 8191;
		this.r[1] = (t0 >>> 13 | t1 << 3) & 8191;
		this.r[2] = (t1 >>> 10 | t2 << 6) & 7939;
		this.r[3] = (t2 >>> 7 | t3 << 9) & 8191;
		this.r[4] = (t3 >>> 4 | t4 << 12) & 255;
		this.r[5] = t4 >>> 1 & 8190;
		this.r[6] = (t4 >>> 14 | t5 << 2) & 8191;
		this.r[7] = (t5 >>> 11 | t6 << 5) & 8065;
		this.r[8] = (t6 >>> 8 | t7 << 8) & 8191;
		this.r[9] = t7 >>> 5 & 127;
		for (let i = 0; i < 8; i++) this.pad[i] = u8to16(key, 16 + 2 * i);
	}
	process(data, offset, isLast = false) {
		const hibit = isLast ? 0 : 2048;
		const { h, r } = this;
		const r0 = r[0];
		const r1 = r[1];
		const r2 = r[2];
		const r3 = r[3];
		const r4 = r[4];
		const r5 = r[5];
		const r6 = r[6];
		const r7 = r[7];
		const r8 = r[8];
		const r9 = r[9];
		const t0 = u8to16(data, offset + 0);
		const t1 = u8to16(data, offset + 2);
		const t2 = u8to16(data, offset + 4);
		const t3 = u8to16(data, offset + 6);
		const t4 = u8to16(data, offset + 8);
		const t5 = u8to16(data, offset + 10);
		const t6 = u8to16(data, offset + 12);
		const t7 = u8to16(data, offset + 14);
		let h0 = h[0] + (t0 & 8191);
		let h1 = h[1] + ((t0 >>> 13 | t1 << 3) & 8191);
		let h2 = h[2] + ((t1 >>> 10 | t2 << 6) & 8191);
		let h3 = h[3] + ((t2 >>> 7 | t3 << 9) & 8191);
		let h4 = h[4] + ((t3 >>> 4 | t4 << 12) & 8191);
		let h5 = h[5] + (t4 >>> 1 & 8191);
		let h6 = h[6] + ((t4 >>> 14 | t5 << 2) & 8191);
		let h7 = h[7] + ((t5 >>> 11 | t6 << 5) & 8191);
		let h8 = h[8] + ((t6 >>> 8 | t7 << 8) & 8191);
		let h9 = h[9] + (t7 >>> 5 | hibit);
		let c = 0;
		let d0 = c + h0 * r0 + h1 * (5 * r9) + h2 * (5 * r8) + h3 * (5 * r7) + h4 * (5 * r6);
		c = d0 >>> 13;
		d0 &= 8191;
		d0 += h5 * (5 * r5) + h6 * (5 * r4) + h7 * (5 * r3) + h8 * (5 * r2) + h9 * (5 * r1);
		c += d0 >>> 13;
		d0 &= 8191;
		let d1 = c + h0 * r1 + h1 * r0 + h2 * (5 * r9) + h3 * (5 * r8) + h4 * (5 * r7);
		c = d1 >>> 13;
		d1 &= 8191;
		d1 += h5 * (5 * r6) + h6 * (5 * r5) + h7 * (5 * r4) + h8 * (5 * r3) + h9 * (5 * r2);
		c += d1 >>> 13;
		d1 &= 8191;
		let d2 = c + h0 * r2 + h1 * r1 + h2 * r0 + h3 * (5 * r9) + h4 * (5 * r8);
		c = d2 >>> 13;
		d2 &= 8191;
		d2 += h5 * (5 * r7) + h6 * (5 * r6) + h7 * (5 * r5) + h8 * (5 * r4) + h9 * (5 * r3);
		c += d2 >>> 13;
		d2 &= 8191;
		let d3 = c + h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * (5 * r9);
		c = d3 >>> 13;
		d3 &= 8191;
		d3 += h5 * (5 * r8) + h6 * (5 * r7) + h7 * (5 * r6) + h8 * (5 * r5) + h9 * (5 * r4);
		c += d3 >>> 13;
		d3 &= 8191;
		let d4 = c + h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0;
		c = d4 >>> 13;
		d4 &= 8191;
		d4 += h5 * (5 * r9) + h6 * (5 * r8) + h7 * (5 * r7) + h8 * (5 * r6) + h9 * (5 * r5);
		c += d4 >>> 13;
		d4 &= 8191;
		let d5 = c + h0 * r5 + h1 * r4 + h2 * r3 + h3 * r2 + h4 * r1;
		c = d5 >>> 13;
		d5 &= 8191;
		d5 += h5 * r0 + h6 * (5 * r9) + h7 * (5 * r8) + h8 * (5 * r7) + h9 * (5 * r6);
		c += d5 >>> 13;
		d5 &= 8191;
		let d6 = c + h0 * r6 + h1 * r5 + h2 * r4 + h3 * r3 + h4 * r2;
		c = d6 >>> 13;
		d6 &= 8191;
		d6 += h5 * r1 + h6 * r0 + h7 * (5 * r9) + h8 * (5 * r8) + h9 * (5 * r7);
		c += d6 >>> 13;
		d6 &= 8191;
		let d7 = c + h0 * r7 + h1 * r6 + h2 * r5 + h3 * r4 + h4 * r3;
		c = d7 >>> 13;
		d7 &= 8191;
		d7 += h5 * r2 + h6 * r1 + h7 * r0 + h8 * (5 * r9) + h9 * (5 * r8);
		c += d7 >>> 13;
		d7 &= 8191;
		let d8 = c + h0 * r8 + h1 * r7 + h2 * r6 + h3 * r5 + h4 * r4;
		c = d8 >>> 13;
		d8 &= 8191;
		d8 += h5 * r3 + h6 * r2 + h7 * r1 + h8 * r0 + h9 * (5 * r9);
		c += d8 >>> 13;
		d8 &= 8191;
		let d9 = c + h0 * r9 + h1 * r8 + h2 * r7 + h3 * r6 + h4 * r5;
		c = d9 >>> 13;
		d9 &= 8191;
		d9 += h5 * r4 + h6 * r3 + h7 * r2 + h8 * r1 + h9 * r0;
		c += d9 >>> 13;
		d9 &= 8191;
		c = (c << 2) + c | 0;
		c = c + d0 | 0;
		d0 = c & 8191;
		c = c >>> 13;
		d1 += c;
		h[0] = d0;
		h[1] = d1;
		h[2] = d2;
		h[3] = d3;
		h[4] = d4;
		h[5] = d5;
		h[6] = d6;
		h[7] = d7;
		h[8] = d8;
		h[9] = d9;
	}
	finalize() {
		const { h, pad } = this;
		const g = new Uint16Array(10);
		let c = h[1] >>> 13;
		h[1] &= 8191;
		for (let i = 2; i < 10; i++) {
			h[i] += c;
			c = h[i] >>> 13;
			h[i] &= 8191;
		}
		h[0] += c * 5;
		c = h[0] >>> 13;
		h[0] &= 8191;
		h[1] += c;
		c = h[1] >>> 13;
		h[1] &= 8191;
		h[2] += c;
		g[0] = h[0] + 5;
		c = g[0] >>> 13;
		g[0] &= 8191;
		for (let i = 1; i < 10; i++) {
			g[i] = h[i] + c;
			c = g[i] >>> 13;
			g[i] &= 8191;
		}
		g[9] -= 8192;
		let mask = (c ^ 1) - 1;
		for (let i = 0; i < 10; i++) g[i] &= mask;
		mask = ~mask;
		for (let i = 0; i < 10; i++) h[i] = h[i] & mask | g[i];
		h[0] = (h[0] | h[1] << 13) & 65535;
		h[1] = (h[1] >>> 3 | h[2] << 10) & 65535;
		h[2] = (h[2] >>> 6 | h[3] << 7) & 65535;
		h[3] = (h[3] >>> 9 | h[4] << 4) & 65535;
		h[4] = (h[4] >>> 12 | h[5] << 1 | h[6] << 14) & 65535;
		h[5] = (h[6] >>> 2 | h[7] << 11) & 65535;
		h[6] = (h[7] >>> 5 | h[8] << 8) & 65535;
		h[7] = (h[8] >>> 8 | h[9] << 5) & 65535;
		let f = h[0] + pad[0];
		h[0] = f & 65535;
		for (let i = 1; i < 8; i++) {
			f = (h[i] + pad[i] | 0) + (f >>> 16) | 0;
			h[i] = f & 65535;
		}
		clean(g);
	}
	update(data) {
		aexists(this);
		abytes(data);
		data = copyBytes(data);
		const { buffer, blockLen } = this;
		const len = data.length;
		for (let pos = 0; pos < len;) {
			const take = Math.min(blockLen - this.pos, len - pos);
			if (take === blockLen) {
				for (; blockLen <= len - pos; pos += blockLen) this.process(data, pos);
				continue;
			}
			buffer.set(data.subarray(pos, pos + take), this.pos);
			this.pos += take;
			pos += take;
			if (this.pos === blockLen) {
				this.process(buffer, 0, false);
				this.pos = 0;
			}
		}
		return this;
	}
	destroy() {
		clean(this.h, this.r, this.buffer, this.pad);
	}
	digestInto(out) {
		aexists(this);
		aoutput(out, this);
		this.finished = true;
		const { buffer, h } = this;
		let { pos } = this;
		if (pos) {
			buffer[pos++] = 1;
			for (; pos < 16; pos++) buffer[pos] = 0;
			this.process(buffer, 0, true);
		}
		this.finalize();
		let opos = 0;
		for (let i = 0; i < 8; i++) {
			out[opos++] = h[i] >>> 0;
			out[opos++] = h[i] >>> 8;
		}
		return out;
	}
	digest() {
		const { buffer, outputLen } = this;
		this.digestInto(buffer);
		const res = buffer.slice(0, outputLen);
		this.destroy();
		return res;
	}
};
function wrapConstructorWithKey(hashCons) {
	const hashC = (msg, key) => hashCons(key).update(msg).digest();
	const tmp = hashCons(new Uint8Array(32));
	hashC.outputLen = tmp.outputLen;
	hashC.blockLen = tmp.blockLen;
	hashC.create = (key) => hashCons(key);
	return hashC;
}
(() => wrapConstructorWithKey((key) => new Poly1305(key)))();
//#endregion
//#region node_modules/@noble/ciphers/chacha.js
/**
* ChaCha stream cipher, released
* in 2008. Developed after Salsa20, ChaCha aims to increase diffusion per round.
* It was standardized in [RFC 8439](https://www.rfc-editor.org/rfc/rfc8439) and
* is now used in TLS 1.3.
*
* [XChaCha20](https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-xchacha)
* extended-nonce variant is also provided. Similar to XSalsa, it's safe to use with
* randomly-generated nonces.
*
* Check out [PDF](http://cr.yp.to/chacha/chacha-20080128.pdf) and
* [wiki](https://en.wikipedia.org/wiki/Salsa20) and
* [website](https://cr.yp.to/chacha.html).
*
* @module
*/
/** Identical to `chachaCore_small`. Unused. */
function chachaCore(s, k, n, out, cnt, rounds = 20) {
	let y00 = s[0], y01 = s[1], y02 = s[2], y03 = s[3], y04 = k[0], y05 = k[1], y06 = k[2], y07 = k[3], y08 = k[4], y09 = k[5], y10 = k[6], y11 = k[7], y12 = cnt, y13 = n[0], y14 = n[1], y15 = n[2];
	let x00 = y00, x01 = y01, x02 = y02, x03 = y03, x04 = y04, x05 = y05, x06 = y06, x07 = y07, x08 = y08, x09 = y09, x10 = y10, x11 = y11, x12 = y12, x13 = y13, x14 = y14, x15 = y15;
	for (let r = 0; r < rounds; r += 2) {
		x00 = x00 + x04 | 0;
		x12 = rotl(x12 ^ x00, 16);
		x08 = x08 + x12 | 0;
		x04 = rotl(x04 ^ x08, 12);
		x00 = x00 + x04 | 0;
		x12 = rotl(x12 ^ x00, 8);
		x08 = x08 + x12 | 0;
		x04 = rotl(x04 ^ x08, 7);
		x01 = x01 + x05 | 0;
		x13 = rotl(x13 ^ x01, 16);
		x09 = x09 + x13 | 0;
		x05 = rotl(x05 ^ x09, 12);
		x01 = x01 + x05 | 0;
		x13 = rotl(x13 ^ x01, 8);
		x09 = x09 + x13 | 0;
		x05 = rotl(x05 ^ x09, 7);
		x02 = x02 + x06 | 0;
		x14 = rotl(x14 ^ x02, 16);
		x10 = x10 + x14 | 0;
		x06 = rotl(x06 ^ x10, 12);
		x02 = x02 + x06 | 0;
		x14 = rotl(x14 ^ x02, 8);
		x10 = x10 + x14 | 0;
		x06 = rotl(x06 ^ x10, 7);
		x03 = x03 + x07 | 0;
		x15 = rotl(x15 ^ x03, 16);
		x11 = x11 + x15 | 0;
		x07 = rotl(x07 ^ x11, 12);
		x03 = x03 + x07 | 0;
		x15 = rotl(x15 ^ x03, 8);
		x11 = x11 + x15 | 0;
		x07 = rotl(x07 ^ x11, 7);
		x00 = x00 + x05 | 0;
		x15 = rotl(x15 ^ x00, 16);
		x10 = x10 + x15 | 0;
		x05 = rotl(x05 ^ x10, 12);
		x00 = x00 + x05 | 0;
		x15 = rotl(x15 ^ x00, 8);
		x10 = x10 + x15 | 0;
		x05 = rotl(x05 ^ x10, 7);
		x01 = x01 + x06 | 0;
		x12 = rotl(x12 ^ x01, 16);
		x11 = x11 + x12 | 0;
		x06 = rotl(x06 ^ x11, 12);
		x01 = x01 + x06 | 0;
		x12 = rotl(x12 ^ x01, 8);
		x11 = x11 + x12 | 0;
		x06 = rotl(x06 ^ x11, 7);
		x02 = x02 + x07 | 0;
		x13 = rotl(x13 ^ x02, 16);
		x08 = x08 + x13 | 0;
		x07 = rotl(x07 ^ x08, 12);
		x02 = x02 + x07 | 0;
		x13 = rotl(x13 ^ x02, 8);
		x08 = x08 + x13 | 0;
		x07 = rotl(x07 ^ x08, 7);
		x03 = x03 + x04 | 0;
		x14 = rotl(x14 ^ x03, 16);
		x09 = x09 + x14 | 0;
		x04 = rotl(x04 ^ x09, 12);
		x03 = x03 + x04 | 0;
		x14 = rotl(x14 ^ x03, 8);
		x09 = x09 + x14 | 0;
		x04 = rotl(x04 ^ x09, 7);
	}
	let oi = 0;
	out[oi++] = y00 + x00 | 0;
	out[oi++] = y01 + x01 | 0;
	out[oi++] = y02 + x02 | 0;
	out[oi++] = y03 + x03 | 0;
	out[oi++] = y04 + x04 | 0;
	out[oi++] = y05 + x05 | 0;
	out[oi++] = y06 + x06 | 0;
	out[oi++] = y07 + x07 | 0;
	out[oi++] = y08 + x08 | 0;
	out[oi++] = y09 + x09 | 0;
	out[oi++] = y10 + x10 | 0;
	out[oi++] = y11 + x11 | 0;
	out[oi++] = y12 + x12 | 0;
	out[oi++] = y13 + x13 | 0;
	out[oi++] = y14 + x14 | 0;
	out[oi++] = y15 + x15 | 0;
}
/**
* ChaCha stream cipher. Conforms to RFC 8439 (IETF, TLS). 12-byte nonce, 4-byte counter.
* With smaller nonce, it's not safe to make it random (CSPRNG), due to collision chance.
*/
const chacha20 = /* @__PURE__ */ createCipher(chachaCore, {
	counterRight: false,
	counterLength: 4,
	allowShortKeys: false
});
//#endregion
//#region node_modules/nostr-tools/node_modules/@noble/hashes/hkdf.js
init_hmac();
init_utils$1();
/**
* HKDF-extract from spec. Less important part. `HKDF-Extract(IKM, salt) -> PRK`
* Arguments position differs from spec (IKM is first one, since it is not optional)
* @param hash - hash function that would be used (e.g. sha256)
* @param ikm - input keying material, the initial key
* @param salt - optional salt value (a non-secret random value)
*/
function extract(hash, ikm, salt) {
	ahash$1(hash);
	if (salt === void 0) salt = new Uint8Array(hash.outputLen);
	return hmac$1(hash, salt, ikm);
}
const HKDF_COUNTER = /* @__PURE__ */ Uint8Array.of(0);
const EMPTY_BUFFER = /* @__PURE__ */ Uint8Array.of();
/**
* HKDF-expand from the spec. The most important part. `HKDF-Expand(PRK, info, L) -> OKM`
* @param hash - hash function that would be used (e.g. sha256)
* @param prk - a pseudorandom key of at least HashLen octets (usually, the output from the extract step)
* @param info - optional context and application specific information (can be a zero-length string)
* @param length - length of output keying material in bytes
*/
function expand(hash, prk, info, length = 32) {
	ahash$1(hash);
	anumber$4(length, "length");
	const olen = hash.outputLen;
	if (length > 255 * olen) throw new Error("Length must be <= 255*HashLen");
	const blocks = Math.ceil(length / olen);
	if (info === void 0) info = EMPTY_BUFFER;
	else abytes$4(info, void 0, "info");
	const okm = new Uint8Array(blocks * olen);
	const HMAC = hmac$1.create(hash, prk);
	const HMACTmp = HMAC._cloneInto();
	const T = new Uint8Array(HMAC.outputLen);
	for (let counter = 0; counter < blocks; counter++) {
		HKDF_COUNTER[0] = counter + 1;
		HMACTmp.update(counter === 0 ? EMPTY_BUFFER : T).update(info).update(HKDF_COUNTER).digestInto(T);
		okm.set(T, olen * counter);
		HMAC._cloneInto(HMACTmp);
	}
	HMAC.destroy();
	HMACTmp.destroy();
	clean$2(T, HKDF_COUNTER);
	return okm.slice(0, length);
}
//#endregion
//#region node_modules/nostr-tools/lib/esm/nip44.js
init_secp256k1();
init_hmac();
init_sha2();
init_utils$1();
var utf8Decoder$1 = new TextDecoder("utf-8");
var utf8Encoder$2 = new TextEncoder();
var minPlaintextSize$1 = 1;
var maxPlaintextSize$1 = 4294967295;
var extendedPrefixThreshold$1 = 65536;
function getConversationKey$1(privkeyA, pubkeyB) {
	return extract(sha256$1, secp256k1$1.getSharedSecret(privkeyA, hexToBytes$2("02" + pubkeyB)).subarray(1, 33), utf8Encoder$2.encode("nip44-v2"));
}
function getMessageKeys$1(conversationKey, nonce) {
	const keys = expand(sha256$1, conversationKey, nonce, 76);
	return {
		chacha_key: keys.subarray(0, 32),
		chacha_nonce: keys.subarray(32, 44),
		hmac_key: keys.subarray(44, 76)
	};
}
function calcPaddedLen$1(len) {
	if (!Number.isSafeInteger(len) || len < 1) throw new Error("expected positive integer");
	if (len <= 32) return 32;
	const nextPower = 2 ** (Math.floor(Math.log2(len - 1)) + 1);
	const chunk = nextPower <= 256 ? 32 : nextPower / 8;
	return chunk * (Math.floor((len - 1) / chunk) + 1);
}
function writeU16BE$1(num) {
	if (!Number.isSafeInteger(num) || num < minPlaintextSize$1 || num > 65535) throw new Error("invalid plaintext size: must be between 1 and 65535 bytes");
	const arr = new Uint8Array(2);
	new DataView(arr.buffer).setUint16(0, num, false);
	return arr;
}
function writeU32BE$1(num) {
	if (!Number.isSafeInteger(num) || num < extendedPrefixThreshold$1 || num > maxPlaintextSize$1) throw new Error("invalid plaintext size: must be between 65536 and 4294967295 bytes");
	const arr = new Uint8Array(4);
	new DataView(arr.buffer).setUint32(0, num, false);
	return arr;
}
function pad$1(plaintext) {
	const unpadded = utf8Encoder$2.encode(plaintext);
	const unpaddedLen = unpadded.length;
	if (unpaddedLen < minPlaintextSize$1 || unpaddedLen > maxPlaintextSize$1) throw new Error("invalid plaintext size: must be between 1 and 4294967295 bytes");
	return concatBytes$2(unpaddedLen >= extendedPrefixThreshold$1 ? concatBytes$2(new Uint8Array([0, 0]), writeU32BE$1(unpaddedLen)) : writeU16BE$1(unpaddedLen), unpadded, new Uint8Array(calcPaddedLen$1(unpaddedLen) - unpaddedLen));
}
function unpad$1(padded) {
	const dv = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
	const firstTwo = dv.getUint16(0);
	let unpaddedLen;
	let prefixLen;
	if (firstTwo === 0) {
		unpaddedLen = dv.getUint32(2);
		if (unpaddedLen < extendedPrefixThreshold$1) throw new Error("invalid padding");
		prefixLen = 6;
	} else {
		unpaddedLen = firstTwo;
		prefixLen = 2;
	}
	const unpadded = padded.subarray(prefixLen, prefixLen + unpaddedLen);
	if (unpaddedLen < minPlaintextSize$1 || unpaddedLen > maxPlaintextSize$1 || unpadded.length !== unpaddedLen || padded.length !== prefixLen + calcPaddedLen$1(unpaddedLen)) throw new Error("invalid padding");
	return utf8Decoder$1.decode(unpadded);
}
function hmacAad$1(key, message, aad) {
	if (aad.length !== 32) throw new Error("AAD associated data must be 32 bytes");
	return hmac$1(sha256$1, key, concatBytes$2(aad, message));
}
function decodePayload$1(payload) {
	if (typeof payload !== "string") throw new Error("payload must be a valid string");
	const plen = payload.length;
	if (plen < 132) throw new Error("invalid payload length: " + plen);
	if (payload[0] === "#") throw new Error("unknown encryption version");
	let data;
	try {
		data = base64$1.decode(payload);
	} catch (error) {
		throw new Error("invalid base64: " + error.message);
	}
	const dlen = data.length;
	if (dlen < 99) throw new Error("invalid data length: " + dlen);
	const vers = data[0];
	if (vers !== 2) throw new Error("unknown encryption version " + vers);
	return {
		nonce: data.subarray(1, 33),
		ciphertext: data.subarray(33, -32),
		mac: data.subarray(-32)
	};
}
function encrypt$2(plaintext, conversationKey, nonce = randomBytes$2(32)) {
	const { chacha_key, chacha_nonce, hmac_key } = getMessageKeys$1(conversationKey, nonce);
	const ciphertext = chacha20(chacha_key, chacha_nonce, pad$1(plaintext));
	const mac = hmacAad$1(hmac_key, ciphertext, nonce);
	return base64$1.encode(concatBytes$2(new Uint8Array([2]), nonce, ciphertext, mac));
}
function decrypt$2(payload, conversationKey) {
	const { nonce, ciphertext, mac } = decodePayload$1(payload);
	const { chacha_key, chacha_nonce, hmac_key } = getMessageKeys$1(conversationKey, nonce);
	if (!equalBytes(hmacAad$1(hmac_key, ciphertext, nonce), mac)) throw new Error("invalid MAC");
	return unpad$1(chacha20(chacha_key, chacha_nonce, ciphertext));
}
//#endregion
//#region src/concord-v2/lib/derive.ts
/**
* Concord V2 derivations — CORD-02 Appendix A (frozen).
*
* Everything Concord addresses on the wire derives from a Community secret
* through one of the shapes below. Changing any labeled byte re-addresses every
* prior event, so treat this file as wire format.
*
* Construction (A.1): `HKDF-SHA256(ikm=secret, salt=∅, info, L=32)` where
*   `info = utf8(label) || 0x00 || id[32] || epoch_be[8]?`
* The id is always present (all-zeroes where a label has no meaningful id);
* the epoch is the only omittable field. The scalar_normalize retry counter
* (A.3) appends after whatever fields are present, starting at byte 0.
*/
const LABEL_CHANNEL = "concord/channel";
const LABEL_CONTROL = "concord/control";
const LABEL_GUESTBOOK = "concord/guestbook";
const LABEL_VOICE_SIGNER = "concord/voice-signer";
const LABEL_VOICE_MEDIA = "concord/voice-media";
const LABEL_GRANT = "concord/grant";
const LABEL_BANLIST = "concord/banlist";
const LABEL_INVITE_LINKS = "concord/invite-links";
const LABEL_INVITE_KEY = "concord/invite-key";
/** The community_id commitment prefix (A.4) — plain SHA-256, NOT the hkdf shape. */
const LABEL_COMMUNITY = "concord/community";
const ZERO32 = new Uint8Array(32);
const ASCII = new TextEncoder();
/** 32 cryptographically-random bytes. */
function random32() {
	return crypto.getRandomValues(new Uint8Array(32));
}
/** Parse a 64-char hex string to 32 bytes, throwing on malformed input. */
function hex32(hex) {
	if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`invalid 64-char hex (got ${hex.length} chars)`);
	return hexToBytes$1(hex.toLowerCase());
}
function assert32(name, b) {
	if (b.length !== 32) throw new Error(`${name} must be 32 bytes, got ${b.length}`);
}
function toEpoch(epoch) {
	return typeof epoch === "bigint" ? epoch : BigInt(epoch);
}
/** `utf8(label) || 0x00 || id[32] || epoch_be[8]?` — epoch omitted when undefined. */
function buildInfo(label, id32, epoch) {
	assert32("id", id32);
	const labelBytes = ASCII.encode(label);
	const hasEpoch = epoch !== void 0;
	const out = new Uint8Array(labelBytes.length + 1 + 32 + (hasEpoch ? 8 : 0));
	let o = 0;
	out.set(labelBytes, o);
	o += labelBytes.length;
	out[o] = 0;
	o += 1;
	out.set(id32, o);
	o += 32;
	if (hasEpoch) new DataView(out.buffer).setBigUint64(o, epoch, false);
	return out;
}
/** HKDF-SHA256, zero-length salt, 32-byte output. */
function hkdf32(ikm, info) {
	return hkdf(sha256, ikm, new Uint8Array(0), info, 32);
}
/**
* Reduce an hkdf seed to a valid secp256k1 secret key. If the seed is not a
* valid scalar, append one incrementing counter byte to the info and retry,
* the counter starting at 0 (A.3). The reject branch is ~2^-128 rare; the
* counter keeps it deterministic across implementations.
*/
function hkdfToSecretKey(ikm, baseInfo) {
	{
		const seed = hkdf32(ikm, baseInfo);
		if (secp256k1.utils.isValidSecretKey(seed)) return seed;
	}
	for (let counter = 0; counter <= 255; counter++) {
		const info = new Uint8Array(baseInfo.length + 1);
		info.set(baseInfo, 0);
		info[baseInfo.length] = counter;
		const seed = hkdf32(ikm, info);
		if (secp256k1.utils.isValidSecretKey(seed)) return seed;
	}
	throw new Error("scalar rejection 257 times running is impossible");
}
function groupKey(label, secret, id, epoch) {
	const sk = hkdfToSecretKey(secret, buildInfo(label, id, epoch));
	const pk = bytesToHex$1(schnorr.getPublicKey(sk));
	return {
		sk,
		pk,
		convKey: getConversationKey$1(sk, pk)
	};
}
/**
* `groupKey` memo. A single derivation costs one HKDF plus TWO secp256k1
* point multiplications (~ms each on a phone), and the app re-derives every
* community's full key set on short polls (stream-auth registration each 20s,
* subscription and wire rebuilds each 60s/2min) — uncached, that alone was
* seconds of main-thread crypto per poll for multi-community users.
*
* Caching is sound because the derivation is a pure function of
* (label, secret, id, epoch) — CORD-02 Appendix A is frozen — and every
* consumer treats GroupKeys as read-only (no zeroization exists here).
* FIFO-bounded: entries are tiny (~200B) and the working set is
* O(communities × channels × held epochs), far under the cap.
*/
const groupKeyMemo = /* @__PURE__ */ new Map();
const GROUP_KEY_MEMO_MAX = 8192;
function groupKeyCached(label, secret, id, epoch) {
	const memoKey = `${label}|${bytesToHex$1(secret)}|${bytesToHex$1(id)}|${epoch ?? ""}`;
	const hit = groupKeyMemo.get(memoKey);
	if (hit) return hit;
	const key = groupKey(label, secret, id, epoch);
	if (groupKeyMemo.size >= GROUP_KEY_MEMO_MAX) groupKeyMemo.delete(groupKeyMemo.keys().next().value);
	groupKeyMemo.set(memoKey, key);
	return key;
}
/**
* A Channel's group key. `secret` is the community_root for a Public Channel
* (at the root epoch) or the Channel's independent key for a Private one (at
* its own channel epoch) — CORD-03 §1.
*/
function channelGroupKey(secret, channelId, epoch) {
	assert32("secret", secret);
	assert32("channelId", channelId);
	return groupKeyCached(LABEL_CHANNEL, secret, channelId, toEpoch(epoch));
}
/** The Control Plane's group key (community_root-keyed). */
function controlGroupKey(communityRoot, communityId, epoch) {
	assert32("communityRoot", communityRoot);
	assert32("communityId", communityId);
	return groupKeyCached(LABEL_CONTROL, communityRoot, communityId, toEpoch(epoch));
}
/** The Guestbook Plane's group key (community_root-keyed). */
function guestbookGroupKey(communityRoot, communityId, epoch) {
	assert32("communityRoot", communityRoot);
	assert32("communityId", communityId);
	return groupKeyCached(LABEL_GUESTBOOK, communityRoot, communityId, toEpoch(epoch));
}
/**
* A voice Channel's SFU room keypair (CORD-07 §1): `voice_key.pk` IS the SFU
* room name and `voice_key.sk` signs token grants (§2). `secret`/`epoch` are
* the same pair that addresses the Channel's Chat Plane — the community_root at
* the root epoch for a Public Channel, the Channel's own key/epoch for a
* Private one — so the room rolls exactly when the Channel's key does. The
* `group_key` shape is reused only for its deterministic keypair; the pk is
* never a stream address.
*/
function voiceGroupKey(secret, channelId, epoch) {
	assert32("secret", secret);
	assert32("channelId", channelId);
	return groupKeyCached(LABEL_VOICE_SIGNER, secret, channelId, toEpoch(epoch));
}
/**
* A voice Channel's raw 32-byte media-encryption root (CORD-07 §1). Never feeds
* a cipher directly — every publisher's per-sender frame key derives from it
* (see {@link voiceSenderKey}).
*/
function voiceMediaKey(secret, channelId, epoch) {
	assert32("secret", secret);
	assert32("channelId", channelId);
	return hkdf32(secret, buildInfo(LABEL_VOICE_MEDIA, channelId, toEpoch(epoch)));
}
/** A member's Grant entity coordinate (the edition `eid`). */
function grantLocator(communityId, memberXonly) {
	assert32("communityId", communityId);
	assert32("memberXonly", memberXonly);
	return hkdf32(communityId, buildInfo(LABEL_GRANT, memberXonly));
}
/** The community-wide Banlist coordinate. */
function banlistLocator(communityId) {
	assert32("communityId", communityId);
	return hkdf32(communityId, buildInfo(LABEL_BANLIST, ZERO32));
}
/** A creator's invite-link Registry coordinate (CORD-05 §5). */
function inviteLinksLocator(communityId, creatorXonly) {
	assert32("communityId", communityId);
	assert32("creatorXonly", creatorXonly);
	return hkdf32(communityId, buildInfo(LABEL_INVITE_LINKS, creatorXonly));
}
/** The public-invite bundle decrypt key, derived from the link's unlock token. */
function inviteBundleKey(token) {
	return hkdf32(token, buildInfo(LABEL_INVITE_KEY, ZERO32));
}
/**
* The self-certifying community identity:
* `sha256("concord/community" || owner_xonly || owner_salt)`.
*/
function communityIdOf(ownerXonly, ownerSalt) {
	assert32("ownerXonly", ownerXonly);
	assert32("ownerSalt", ownerSalt);
	const label = ASCII.encode(LABEL_COMMUNITY);
	const pre = new Uint8Array(label.length + 64);
	pre.set(label, 0);
	pre.set(ownerXonly, label.length);
	pre.set(ownerSalt, label.length + 32);
	return sha256(pre);
}
/** Verify a claimed (owner, salt) pair reproduces `communityId`. */
function verifyCommunityId(communityIdHex, ownerHex, ownerSaltHex) {
	try {
		return bytesToHex$1(communityIdOf(hex32(ownerHex), hex32(ownerSaltHex))) === communityIdHex.toLowerCase();
	} catch {
		return false;
	}
}
//#endregion
//#region src/concord-v2/lib/kinds.ts
/**
* Concord V2 event-kind registry — CORD-02 Appendix B (frozen).
*
* Every durable plane event is a kind-1059 wrap around a seal (CORD-01); the
* INNER rumor carries the functional kind. Standard kinds are reused where one
* fits (9 message, 7 reaction, 5 delete); the dedicated 33xx block covers the
* rest. Retired numbers (3300, 3301, 3304, 3305, 3307, 3311, 23308) are burned
* forever and never appear here.
*/
/** Durable gift wrap (the outer envelope of every stored plane event). */
const KIND_WRAP = 1059;
/** Ephemeral gift wrap — identical structure, relays MUST NOT store it. */
const KIND_WRAP_EPHEMERAL = 21059;
/** Encrypted seal: the rumor is NIP-44-encrypted again inside the wrap. */
const KIND_SEAL_ENCRYPTED = 20013;
/** Plaintext seal: the seal's content is the rumor's JSON string, byte-verbatim. */
const KIND_SEAL_PLAINTEXT = 20014;
/** Join / Leave: self-signed, the content is the verb. */
const KIND_JOIN_LEAVE = 3306;
/** Control edition (sub-kinded by the `vsk` tag). */
const KIND_CONTROL = 3308;
/** Public invite bundle: addressable, signed by the per-link keypair, empty `d`. */
const KIND_INVITE_BUNDLE = 33301;
//#endregion
//#region src/lib/sanitizeUrl.ts
/**
* Whether a URL points at a local-network address (loopback, RFC-1918 private,
* link-local, `.local`/`.localhost`). Untrusted event data (custom-emoji URLs,
* avatars, media) can carry a `http://localhost:…` or `http://192.168.x.x/…`
* URL — usually a leaked dev instance — so anything that turns such a URL into
* an `<img>`/`fetch` MUST refuse it, or every viewer who renders it gets the
* browser's local-network access prompt.
*/
function isLocalNetworkUrl(raw) {
	if (!raw) return false;
	let host;
	try {
		host = new URL(raw).hostname.toLowerCase();
	} catch {
		return false;
	}
	const h = host.replace(/^\[|\]$/g, "");
	if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
	if (h === "::1" || h === "0.0.0.0") return true;
	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
	if (v4) {
		const a = Number(v4[1]);
		const b = Number(v4[2]);
		if (a === 127 || a === 10 || a === 0) return true;
		if (a === 192 && b === 168) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 169 && b === 254) return true;
	}
	if (/^f[cd][0-9a-f]*:/.test(h)) return true;
	if (/^fe[89ab][0-9a-f]*:/.test(h)) return true;
	return false;
}
/** Community description cap: 10,000 bytes of UTF-8 (CORD-02 §6). */
const DESCRIPTION_MAX_BYTES = 1e4;
/** Canonical relay URL for dedupe + display: lowercase scheme/host, no
* trailing slash. `wss://relay.damus.io/` and `wss://relay.damus.io` are the
* same relay; treating them as distinct strings seeded duplicate entries
* (and double connections) into community relay sets. */
function canonicalRelayUrl(url) {
	try {
		const u = new URL(url);
		const path = u.pathname.replace(/\/+$/, "");
		return `${u.protocol}//${u.host}${path}${u.search}`;
	} catch {
		return url.replace(/\/+$/, "");
	}
}
/** Dedupe (order-preserving, by canonical URL) + truncate a relay set to the
* recommended cap. Emits the canonical form so displays don't mix
* trailing-slash variants of the same relay. */
function capRelays(relays, cap = 15) {
	const seen = /* @__PURE__ */ new Set();
	const out = [];
	for (const r of relays) {
		if (out.length >= cap) break;
		if (typeof r !== "string" || !r || !isSafeCommunityRelayUrl(r)) continue;
		const canonical = canonicalRelayUrl(r);
		if (seen.has(canonical)) continue;
		seen.add(canonical);
		out.push(canonical);
	}
	return out;
}
/** Community metadata is untrusted: never let it steer sockets to arbitrary
* schemes, credential-bearing URLs, or local-network targets. */
function isSafeCommunityRelayUrl(raw) {
	try {
		const url = new URL(raw);
		if (url.username || url.password || url.hash) return false;
		return url.protocol === "wss:" && !isLocalNetworkUrl(raw);
	} catch {
		return false;
	}
}
/** Byte length of a string as UTF-8. */
function utf8Len(s) {
	return new TextEncoder().encode(s).length;
}
/** Runtime check that a value is a plausible {@link ImagePointer}. */
function isImagePointer(v) {
	if (!v || typeof v !== "object") return false;
	const o = v;
	return typeof o.url === "string" && typeof o.key === "string" && /^[0-9a-f]{64}$/i.test(o.key) && typeof o.nonce === "string" && /^[0-9a-f]{32}$/i.test(o.nonce) && typeof o.hash === "string" && /^[0-9a-f]{64}$/i.test(o.hash);
}
var InviteError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "InviteError";
	}
};
/**
* Bound an attacker-crafted bundle before allocating (CORD-05 §1): sane
* channel count, relays truncated to the Community cap.
*/
function boundBundle(bundle) {
	if (!Array.isArray(bundle.channels)) bundle.channels = [];
	if (bundle.channels.length > 256) throw new InviteError("bounds", `bundle carries ${bundle.channels.length} channels (cap 256)`);
	bundle.relays = capRelays(Array.isArray(bundle.relays) ? bundle.relays : []);
	return bundle;
}
/**
* Validate a decrypted bundle regardless of how it arrived — fetched from a
* link's coordinate or handed over whole in a Direct Invite (CORD-05 §6): the
* §1 bounds apply, and the self-certifying `community_id` must reproduce from
* (owner, salt), so even a compromised creator can't smuggle a false owner.
* Throws `bounds` / `owner-mismatch`; expiry is the caller's concern (a parked
* invite still renders past `expires_at` — joining refuses).
*/
function validateBundle(bundle) {
	boundBundle(bundle);
	if (!verifyCommunityId(bundle.community_id, bundle.owner, bundle.owner_salt)) throw new InviteError("owner-mismatch", "bundle's owner does not reproduce its community_id");
	return bundle;
}
/** Build the addressable bundle event: `(33301, link_signer, d="")`, marked live. */
function buildBundleEvent(bundle, token, linkSignerSk) {
	return finalizeEvent$1({
		kind: KIND_INVITE_BUNDLE,
		content: encrypt$2(JSON.stringify(bundle), inviteBundleKey(token)),
		tags: [["d", ""], ["vsk", "6"]],
		created_at: Math.floor(Date.now() / 1e3)
	}, linkSignerSk);
}
/** Re-post the coordinate as a revocation tombstone (creator only — needs the signer). */
function buildRevocationEvent(linkSignerSk) {
	return finalizeEvent$1({
		kind: KIND_INVITE_BUNDLE,
		content: "",
		tags: [["d", ""], ["vsk", "9"]],
		created_at: Math.floor(Date.now() / 1e3)
	}, linkSignerSk);
}
/**
* Verify + decrypt a fetched bundle event. `expectedSigner` is the naddr's
* author — the coordinate itself is the anti-squat guard, but we re-check the
* signature and author to reject a relay handing back garbage. Throws
* `revoked` on a tombstone, `expired` past `expires_at`, `owner-mismatch` when
* (owner, salt) fail to reproduce the community_id.
*/
function parseBundleEvent(event, expectedSigner, token, nowMs) {
	if (event.kind !== 33301 || event.pubkey !== expectedSigner || !verifyEvent$2(event)) throw new InviteError("bad-bundle", "not a valid invite bundle event");
	const vsk = event.tags.find((t) => t[0] === "vsk")?.[1];
	if (vsk === "9") throw new InviteError("revoked", "this invite link has been revoked");
	if (vsk !== "6") throw new InviteError("bad-bundle", `unknown bundle marker: ${vsk}`);
	let bundle;
	try {
		bundle = JSON.parse(decrypt$2(event.content, inviteBundleKey(token)));
	} catch (e) {
		throw new InviteError("bad-bundle", `bundle decrypt: ${e instanceof Error ? e.message : e}`);
	}
	validateBundle(bundle);
	if (typeof bundle.expires_at === "number" && nowMs > bundle.expires_at) throw new InviteError("expired", "this invite link has expired");
	return bundle;
}
/**
* The stock relay dictionary, generation 4: four primaries every client knows,
* referenced by a single byte. Versioned — it grows without breaking older
* links; both Vector and Soapbox ship it identically.
*/
const RELAY_DICTIONARY = {
	1: "wss://jskitty.com/nostr",
	2: "wss://asia.vectorapp.io/nostr",
	3: "wss://relay.ditto.pub",
	4: "wss://relay.dreamith.to"
};
/** The stock set selected by the flags bit (dictionary ids 1–4, in order). */
const STOCK_RELAYS = [
	1,
	2,
	3,
	4
].map((i) => RELAY_DICTIONARY[i]);
/** flags bit 0: the stock set is in use, zero relay bytes follow. */
const FLAG_STOCK_SET = 1;
function toBase64Url(bytes) {
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(s) {
	const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
	const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - b64.length % 4);
	const bin = atob(b64 + pad);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
const DICT_BY_URL = new Map(Object.entries(RELAY_DICTIONARY).map(([id, url]) => [url, Number(id)]));
/**
* Encode the invite fragment: `[version][flags][relays?][token:16]` as
* base64url, no padding. The stock set costs zero relay bytes; otherwise each
* relay is a dictionary id byte, a wss-implied literal (`0, len, host`), or a
* verbatim literal (`255, len, url`).
*/
function encodeFragment(token, relays) {
	if (token.length !== 16) throw new InviteError("bad-fragment", `token must be 16 bytes`);
	const isStock = relays.length === STOCK_RELAYS.length && relays.every((r, i) => r === STOCK_RELAYS[i]);
	const bounded = relays.slice(0, 3);
	const bytes = [4];
	if (isStock) bytes.push(FLAG_STOCK_SET);
	else {
		bytes.push(0, bounded.length);
		const encoder = new TextEncoder();
		for (const relay of bounded) {
			const dictId = DICT_BY_URL.get(relay);
			if (dictId !== void 0) bytes.push(dictId);
			else if (relay.startsWith("wss://")) {
				const host = encoder.encode(relay.slice(6));
				if (host.length > 255) throw new InviteError("bad-fragment", "relay host too long");
				bytes.push(0, host.length, ...host);
			} else {
				const url = encoder.encode(relay);
				if (url.length > 255) throw new InviteError("bad-fragment", "relay URL too long");
				bytes.push(255, url.length, ...url);
			}
		}
	}
	bytes.push(...token);
	return toBase64Url(new Uint8Array(bytes));
}
/** Decode an invite fragment into its token + bootstrap relays. */
function decodeFragment(fragment) {
	let bytes;
	try {
		bytes = fromBase64Url(fragment.trim());
	} catch {
		throw new InviteError("bad-fragment", "fragment is not base64url");
	}
	let o = 0;
	const need = (n) => {
		if (o + n > bytes.length) throw new InviteError("bad-fragment", "fragment truncated");
	};
	need(2);
	const version = bytes[o++];
	if (version < 4) throw new InviteError("bad-fragment", `legacy invite format (version ${version})`);
	if (version > 4) throw new InviteError("bad-fragment", `invite format ${version} is newer than this client`);
	const flags = bytes[o++];
	const relays = [];
	if (flags & FLAG_STOCK_SET) relays.push(...STOCK_RELAYS);
	else {
		need(1);
		const count = bytes[o++];
		if (count > 3) throw new InviteError("bad-fragment", "too many bootstrap relays");
		const decoder = new TextDecoder();
		for (let i = 0; i < count; i++) {
			need(1);
			const lead = bytes[o++];
			if (lead >= 1 && lead <= 254) {
				const url = RELAY_DICTIONARY[lead];
				if (url) relays.push(url);
			} else {
				need(1);
				const len = bytes[o++];
				need(len);
				const text = decoder.decode(bytes.slice(o, o + len));
				o += len;
				relays.push(lead === 255 ? text : `wss://${text}`);
			}
		}
	}
	need(16);
	const token = bytes.slice(o, o + 16);
	o += 16;
	if (o !== bytes.length) throw new InviteError("bad-fragment", "trailing bytes in fragment");
	return {
		token,
		relays
	};
}
const INVITE_PATH_PREFIX = "/invite/";
/** Build the bare naddr for a link signer's bundle coordinate (empty `d`). */
function bundleNaddr(linkSignerPk) {
	return naddrEncode$1({
		kind: KIND_INVITE_BUNDLE,
		pubkey: linkSignerPk,
		identifier: ""
	});
}
/** Build a shareable invite URL on `base` (any deeplink domain works — the base is cosmetic). */
function buildInviteUrl(base, linkSignerPk, token, relays) {
	return `${base.replace(/\/$/, "")}${INVITE_PATH_PREFIX}${bundleNaddr(linkSignerPk)}#${encodeFragment(token, relays)}`;
}
/** Decode a bare naddr into the link-signer pubkey, or undefined if it isn't one. */
function naddrToSigner(naddr) {
	try {
		const decoded = decode$2(naddr);
		if (decoded.type !== "naddr") return void 0;
		const data = decoded.data;
		if (data.kind !== 33301 || data.identifier !== "") return void 0;
		return data.pubkey;
	} catch {
		return;
	}
}
/**
* Parse a V2 invite from a full URL (`…/invite/<naddr>#<fragment>`) or the
* domain-agnostic bare form (`<naddr>#<fragment>`). Returns undefined for
* anything that isn't recognizably a V2 invite (so callers can fall through to
* other classifiers).
*/
function parseInviteLink(input) {
	const trimmed = input.trim();
	let naddr;
	let fragment;
	if (/^naddr1[a-z0-9]+#.+$/i.test(trimmed)) {
		const [head, ...rest] = trimmed.split("#");
		naddr = head;
		fragment = rest.join("#");
	} else {
		let url;
		try {
			url = new URL(trimmed);
		} catch {
			return;
		}
		if (!url.pathname.startsWith("/invite/")) return void 0;
		naddr = decodeURIComponent(url.pathname.slice(8)).replace(/\/$/, "");
		fragment = url.hash.replace(/^#/, "");
	}
	if (!naddr || !fragment) return void 0;
	const linkSigner = naddrToSigner(naddr);
	if (!linkSigner) return void 0;
	let decoded;
	try {
		decoded = decodeFragment(fragment);
	} catch {
		return;
	}
	return {
		linkSigner,
		token: decoded.token,
		bootstrapRelays: decoded.relays,
		naddr
	};
}
/** Mint a fresh link-signer keypair. */
function mintLinkSigner() {
	const sk = generateSecretKey$1();
	return {
		sk,
		pk: getPublicKey$1(sk)
	};
}
/** Mint a fresh 16-byte unlock token. */
function mintToken() {
	return crypto.getRandomValues(new Uint8Array(16));
}
/**
* The public commitment to a link's unlock token: `sha256(token)` hex. A
* Guestbook Join cites it (4th element of the `invite` tag) so anyone folding
* the Guestbook can tell WHICH link a member arrived through — without the
* commitment revealing anything (the token is 128 bits of entropy). This is
* what single-use links and per-link key rotations key on.
*/
function inviteCommitment(token) {
	return bytesToHex$1(sha256(token));
}
//#endregion
//#region src/concord-v2/lib/community.ts
/**
* Concord V2 community assembly — genesis (CORD-02 §1), the runtime channel
* view (CORD-03), and the classifier the Add wizard uses to tell a V2 invite
* from everything else.
*/
/**
* Mint a brand-new community: a random `owner_salt` commits the owner into the
* self-certifying `community_id`, and an independent random `community_root`
* is the access key (deliberately NOT derived from the id, so access can
* rotate while identity stays fixed).
*
* Genesis publishes exactly two owner-signed editions — the metadata and one
* public `#general` Channel — which the caller builds; this mints the secrets
* and the runtime shape.
*/
function mintCommunity(name, ownerPubkeyHex, relays) {
	const ownerSalt = random32();
	const owner = ownerPubkeyHex.toLowerCase();
	const id = communityIdOf(hex32(owner), ownerSalt);
	const root = random32();
	const generalChannelId = random32();
	return {
		community: {
			id,
			idHex: bytesToHex$1(id),
			owner,
			ownerSalt,
			root,
			rootEpoch: 0n,
			heldRoots: [{
				epoch: 0n,
				key: root
			}],
			privateChannels: [],
			relays: capRelays(relays),
			name
		},
		generalChannelId
	};
}
/**
* Assemble the channels the member can actually read from the Control fold +
* held keys:
*
*   - a PUBLIC channel derives its stream from the community_root per held
*     root epoch (readable by every member, rotates with the base for free);
*   - a PRIVATE channel needs its independent key from the member's bundle —
*     lacking it, the channel is omitted (its ciphertext is unreadable anyway);
*   - deleted channels are dropped from display (history stays decryptable to
*     anyone who held the keys, but that's a future "archive" view).
*
* Ordered by name for a stable sidebar.
*/
function channelsView(community, folded) {
	const out = [];
	const seen = /* @__PURE__ */ new Set();
	const privateKeysById = new Map(community.privateChannels.map((ch) => [bytesToHex$1(ch.id), ch]));
	const voiceKeys = (secret, id, epoch) => ({
		room: voiceGroupKey(secret, id, epoch),
		mediaKey: voiceMediaKey(secret, id, epoch)
	});
	for (const def of folded?.channels.values() ?? []) {
		if (def.deleted) continue;
		seen.add(def.channelIdHex);
		const id = hex32(def.channelIdHex);
		if (!def.isPrivate) {
			const streams = community.heldRoots.map((r) => ({
				epoch: r.epoch,
				group: channelGroupKey(r.key, id, r.epoch)
			}));
			out.push({
				id,
				idHex: def.channelIdHex,
				name: def.name,
				isPrivate: false,
				voice: voiceKeys(community.root, id, community.rootEpoch),
				streams,
				current: streams[0]
			});
			continue;
		}
		const held = privateKeysById.get(def.channelIdHex);
		if (!held) continue;
		const stream = {
			epoch: held.epoch,
			group: channelGroupKey(held.key, id, held.epoch)
		};
		out.push({
			id,
			idHex: def.channelIdHex,
			name: def.name,
			isPrivate: true,
			voice: voiceKeys(held.key, id, held.epoch),
			streams: [stream],
			current: stream
		});
	}
	for (const held of community.privateChannels) {
		const idHex = bytesToHex$1(held.id);
		if (seen.has(idHex)) continue;
		const stream = {
			epoch: held.epoch,
			group: channelGroupKey(held.key, held.id, held.epoch)
		};
		out.push({
			id: held.id,
			idHex,
			name: held.name || idHex.slice(0, 8),
			isPrivate: true,
			voice: voiceKeys(held.key, held.id, held.epoch),
			streams: [stream],
			current: stream
		});
	}
	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}
//#endregion
//#region src/concord-v2/lib/stream.ts
/**
* Concord V2 Private Streams — CORD-01.
*
* A stream event is a kind-1059 wrap that REVERSES NIP-59: fixed author (the
* plane's derived stream key), ephemeral `p` tag, and the wrap is encrypted
* under the stream's NIP-44 self-ECDH conversation key — never the p-tagged
* key. Inside rides a seal signed by the author's REAL key, around an unsigned
* rumor carrying the functional kind:
*
*   wrap(1059/21059, signed by stream key)
*     └ seal(20013 encrypted | 20014 plaintext, signed by the author)
*         └ rumor(unsigned, the functional kind)
*
* The encrypted seal (20013) NIP-44-encrypts the rumor again, so no layer can
* be lifted out as a standalone public event; the plaintext seal (20014,
* Control Plane only) carries the rumor's JSON string byte-verbatim so a
* compaction can re-wrap the signed edition into a new epoch (CORD-02 §5).
*/
init_pure();
var StreamError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "StreamError";
	}
};
const TAG_MS = "ms";
function encryptChecked(convKey, plaintext) {
	if (new TextEncoder().encode(plaintext).length > 65535) throw new StreamError("oversize", "plaintext exceeds the NIP-44 65,535-byte cap");
	return encrypt$2(plaintext, convKey);
}
/**
* Build an unsigned rumor. `ms` is the full send time in epoch-milliseconds:
* `created_at` carries the seconds, the `ms` tag the 0..999 remainder, and the
* true event time is `created_at * 1000 + ms` (CORD-02 §4). Pass `ms: null`
* for rumors that don't carry sub-second ordering (control editions).
*/
function buildRumor(opts) {
	const tags = [...opts.tags ?? []];
	let createdAt;
	if (opts.ms === null || opts.ms === void 0) createdAt = opts.createdAtSecs ?? Math.floor(Date.now() / 1e3);
	else {
		if (!Number.isFinite(opts.ms) || opts.ms < 0) throw new StreamError("bad-ms", `send time must be a non-negative epoch-ms, got ${opts.ms}`);
		createdAt = Math.floor(opts.ms / 1e3);
		tags.push([TAG_MS, (Math.floor(opts.ms) % 1e3).toString()]);
	}
	const unsigned = {
		kind: opts.kind,
		content: opts.content,
		tags,
		created_at: createdAt,
		pubkey: opts.pubkey
	};
	return {
		...unsigned,
		id: getEventHash$2(unsigned)
	};
}
/**
* Seal a rumor with the author's REAL identity: an encrypted seal (20013)
* NIP-44s the rumor under the stream conversation key first; a plaintext seal
* (20014) carries the rumor's serialized JSON verbatim. The seal is what the
* author actually signs — one signer round-trip per send.
*/
async function sealRumor(rumor, sealKind, stream, signer) {
	const rumorJson = JSON.stringify(rumor);
	const content = sealKind === 20013 ? encryptChecked(stream.convKey, rumorJson) : rumorJson;
	return signer.signEvent({
		kind: sealKind,
		content,
		tags: [],
		created_at: rumor.created_at
	});
}
/**
* Wrap a signed seal into the outer stream event: encrypted under the stream
* conversation key, signed by the stream key, tagged with a random ephemeral
* `p` (NIP-59 reversed). `created_at` is NOT tweaked (CORD-01). Keep
* `ephemeralSk` if you want to NIP-09-delete the wrap later.
*/
function wrapSeal(seal, stream, opts) {
	const tags = [["p", getPublicKey$1(opts?.ephemeralSk ?? generateSecretKey$1())]];
	if (opts?.expirationAtSecs) tags.push(["expiration", String(opts.expirationAtSecs)]);
	return finalizeEvent$1({
		kind: opts?.ephemeral ? KIND_WRAP_EPHEMERAL : KIND_WRAP,
		content: encryptChecked(stream.convKey, JSON.stringify(seal)),
		tags,
		created_at: Math.floor(Date.now() / 1e3)
	}, stream.sk);
}
/**
* Reconstruct the ms timestamp. A missing tag means offset 0; a malformed tag
* (outside 0..999, non-integer) throws — CORD-02 §5 treats out-of-range `ms`
* as malformed rather than clamping it, or the excess would smuggle arbitrary
* "future" past the clock check.
*/
function resolveMs(createdAtSecs, tags) {
	const tag = tags.find((t) => t[0] === TAG_MS);
	if (!tag) return createdAtSecs * 1e3;
	const raw = tag[1];
	if (raw === void 0 || !/^(0|[1-9][0-9]{0,2})$/.test(raw)) throw new StreamError("bad-ms", `malformed ms tag: ${raw}`);
	const n = Number(raw);
	if (n > 999) throw new StreamError("bad-ms", `malformed ms tag: ${raw}`);
	return createdAtSecs * 1e3 + n;
}
/**
* Open and fully verify one stream wrap under its plane's group key:
*
*   1. the wrap's author must be the stream address (else it isn't ours);
*   2. decrypt the wrap → the seal; verify the seal's Schnorr signature
*      (authorship proof) and that its kind declares a known seal form;
*   3. recover the rumor (decrypting again for 20013); verify the rumor's id
*      is its NIP-01 hash (an id is the ordering tiebreak — never trust a
*      claimed one) and that the rumor's pubkey equals the seal's signer (or a
*      keyholder could re-seal another member's rumor under their own name).
*/
function openWrap(wrap, stream) {
	if (wrap.kind !== 1059 && wrap.kind !== 21059) throw new StreamError("bad-wrap-kind", `not a stream wrap: kind ${wrap.kind}`);
	if (wrap.pubkey !== stream.pk) throw new StreamError("author-mismatch", "wrap author is not this stream's address");
	let seal;
	try {
		seal = JSON.parse(decrypt$2(wrap.content, stream.convKey));
	} catch (e) {
		throw new StreamError("decrypt", `wrap decrypt: ${e instanceof Error ? e.message : e}`);
	}
	if (seal.kind !== 20013 && seal.kind !== 20014) throw new StreamError("bad-seal-kind", `unknown seal kind ${seal.kind}`);
	if (!verifyEvent$2(seal)) throw new StreamError("bad-seal-signature", "seal signature invalid");
	let rumor;
	try {
		const json = seal.kind === 20013 ? decrypt$2(seal.content, stream.convKey) : seal.content;
		rumor = JSON.parse(json);
	} catch (e) {
		throw new StreamError(seal.kind === 20013 ? "decrypt" : "parse", `rumor recover: ${e instanceof Error ? e.message : e}`);
	}
	if (rumor.pubkey !== seal.pubkey) throw new StreamError("author-mismatch", "rumor author does not match the seal's signer");
	const expectedId = getEventHash$2({
		kind: rumor.kind,
		content: rumor.content,
		tags: rumor.tags,
		created_at: rumor.created_at,
		pubkey: rumor.pubkey
	});
	if (rumor.id !== expectedId) throw new StreamError("bad-rumor-id", "rumor id is not its event hash");
	return {
		rumorId: rumor.id,
		author: seal.pubkey,
		kind: rumor.kind,
		content: rumor.content,
		tags: rumor.tags,
		ms: resolveMs(rumor.created_at, rumor.tags),
		createdAt: rumor.created_at,
		wrapId: wrap.id,
		streamPk: wrap.pubkey,
		sealKind: seal.kind,
		seal
	};
}
const TAG_CHANNEL = "channel";
const TAG_EPOCH = "epoch";
/** The binding tags a Chat rumor MUST commit: `["channel", id]` + `["epoch", n]`. */
function channelBindingTags(channelIdHex, epoch) {
	return [[TAG_CHANNEL, channelIdHex], [TAG_EPOCH, epoch.toString()]];
}
/** Value of a tag required to appear AT MOST ONCE (binding must be unambiguous). */
function uniqueTag(tags, name) {
	let found;
	for (const t of tags) if (t[0] === name) {
		if (found !== void 0) throw new StreamError("binding-mismatch", `duplicate binding tag: ${name}`);
		found = t[1];
	}
	return found;
}
/**
* Enforce the Chat-plane binding: the rumor's committed channel + epoch must
* strict-equal the coordinate whose key decrypted the wrap, or a keyholder
* could splice one author's rumor into a context they never chose.
*/
function checkChannelBinding(opened, channelIdHex, epoch) {
	if (uniqueTag(opened.tags, TAG_CHANNEL) !== channelIdHex) throw new StreamError("binding-mismatch", "channel-binding mismatch (splice)");
	if (uniqueTag(opened.tags, TAG_EPOCH) !== epoch.toString()) throw new StreamError("binding-mismatch", "epoch-binding mismatch (splice)");
}
//#endregion
//#region src/concord-v2/lib/version.ts
/**
* Per-entity version chains for Control Plane editions — CORD-04 §1.
*
* Every entity (Role, Grant, Banlist, metadata, Registry) is a sequence of
* editions, each carrying a monotonic `version` + the hash of its predecessor.
* Clients fold the fetched set into the current head: refuse-downgrade,
* deterministic equal-version tiebreak (lower rumor id), and contiguous
* chain-walk with gap detection (fail closed) — except across a Refounding,
* where a fresh joiner accepts the highest authority-verified head despite a
* dangling `prev` ({@link bootstrapHead}).
*/
/**
* The edition-hash domain label — CORD-04 §1, frozen. (Yes, it says "v1": the
* spec pins this exact string; renaming it would re-hash every chain.)
*/
const EDITION_LABEL = "vector-community/v1/edition";
function u64be(n) {
	const out = new Uint8Array(8);
	new DataView(out.buffer).setBigUint64(0, n, false);
	return out;
}
/**
* The length-prefixed, domain-separated preimage an edition's identity commits
* to (CORD-04 §1, frozen):
* `len64(label) ‖ label ‖ entity_id[32] ‖ version_be[8] ‖ has_prev(1) ‖
*  prev_hash[32 or zero] ‖ len64(content) ‖ content`.
* `content` is hashed as the exact bytes on the wire, never re-serialized.
*/
function editionPreimage(entityId, version, prevHash, content) {
	const labelBytes = new TextEncoder().encode(EDITION_LABEL);
	const parts = [
		u64be(BigInt(labelBytes.length)),
		labelBytes,
		entityId,
		u64be(version),
		new Uint8Array([prevHash ? 1 : 0]),
		prevHash ?? new Uint8Array(32),
		u64be(BigInt(content.length)),
		content
	];
	const total = parts.reduce((n, p) => n + p.length, 0);
	const out = new Uint8Array(total);
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}
/** SHA-256 of {@link editionPreimage} — what the next edition's `ep` cites. */
function editionHash(entityId, version, prevHash, content) {
	return sha256(editionPreimage(entityId, version, prevHash, content));
}
function cmpBytes(a, b) {
	for (let i = 0; i < a.length && i < b.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
	return a.length - b.length;
}
function bytesEq(a, b) {
	if (a === void 0 || b === void 0) return a === b;
	return a.length === b.length && cmpBytes(a, b) === 0;
}
/**
* Fold a set of editions for ONE entity into its current head, chain-checked.
* `floor` is the highest version already accepted (0n = none), `floorHash`
* that held edition's selfHash.
*/
function fold(editions, floor, floorHash) {
	const byVersion = /* @__PURE__ */ new Map();
	for (let i = 0; i < editions.length; i++) {
		const e = editions[i];
		if (e.version < floor) continue;
		const j = byVersion.get(e.version);
		if (j === void 0 || cmpBytes(e.tiebreakId, editions[j].tiebreakId) < 0) byVersion.set(e.version, i);
	}
	const versions = [...byVersion.keys()].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
	if (versions.length === 0) return {
		head: null,
		gap: false
	};
	const lo = editions[byVersion.get(versions[0])];
	let anchored;
	if (floor === 0n) anchored = versions[0] === 1n && lo.prevHash === void 0;
	else if (versions[0] === floor) anchored = floorHash !== void 0 && bytesEq(floorHash, lo.selfHash);
	else if (versions[0] === floor + 1n) anchored = floorHash !== void 0 && bytesEq(lo.prevHash, floorHash);
	else anchored = false;
	let gap = !anchored;
	let headIdx = byVersion.get(versions[0]);
	for (let k = 0; k + 1 < versions.length; k++) {
		const loIdx = byVersion.get(versions[k]);
		const hiIdx = byVersion.get(versions[k + 1]);
		if (versions[k + 1] === versions[k] + 1n && bytesEq(editions[hiIdx].prevHash, editions[loIdx].selfHash)) headIdx = hiIdx;
		else {
			gap = true;
			break;
		}
	}
	return {
		head: headIdx,
		gap
	};
}
/**
* The head a BOOTSTRAPPING client accepts after a Refounding's compaction
* (CORD-04 §1): the per-version winner at the highest present version,
* ignoring chain contiguity — there is nothing behind a compacted head to
* verify; the signature plus the current-authority check is the whole test.
*/
function bootstrapHead(editions, floor) {
	let best = null;
	for (let i = 0; i < editions.length; i++) {
		const e = editions[i];
		if (e.version < floor) continue;
		if (best === null) best = i;
		else {
			const cur = editions[best];
			if (e.version > cur.version || e.version === cur.version && cmpBytes(e.tiebreakId, cur.tiebreakId) < 0) best = i;
		}
	}
	return best;
}
//#endregion
//#region src/concord-v2/lib/edition.ts
/**
* Concord V2 Control Plane editions — CORD-04 §1.
*
* An edition is a kind-3308 RUMOR (unsigned; authorship is the seal's Schnorr
* signature, which for the Control Plane is a plaintext seal so it survives a
* compaction re-wrap). Its machinery rides tags:
*
*   ["vsk", n]                — entity type (the registry, CORD-02 Appendix B)
*   ["eid", hex32]            — the entity's stable coordinate
*   ["ev",  n]                — this edition's version, climbing from 1
*   ["ep",  hex32]            — prev edition hash (absent on the first)
*   ["vac", eid, ver, hash]   — the authority citation (absent when the owner acts)
*
* There is deliberately NO version tag: absence of a version field always
* means this spec (CORD-02 Appendix B).
*/
const TAG_SUBKIND = "vsk";
const TAG_ENTITY = "eid";
const TAG_EVERSION = "ev";
const TAG_EPREV = "ep";
const TAG_CITATION = "vac";
const HEX64 = /^[0-9a-f]{64}$/i;
function citationToTag(c) {
	return [
		TAG_CITATION,
		bytesToHex$1(c.entityId),
		c.version.toString(),
		bytesToHex$1(c.editionHash)
	];
}
function citationFromTags(tags) {
	const t = tags.find((t) => t.length >= 4 && t[0] === TAG_CITATION);
	if (!t) return void 0;
	if (!HEX64.test(t[1]) || !HEX64.test(t[3]) || !/^\d+$/.test(t[2])) return void 0;
	return {
		entityId: hexToBytes$1(t[1]),
		version: BigInt(t[2]),
		editionHash: hexToBytes$1(t[3])
	};
}
/** Build an unsigned edition rumor (kind 3308). The plaintext SEAL proves the actor. */
function buildEditionRumor(opts) {
	const tags = [
		[TAG_SUBKIND, opts.vsk],
		[TAG_ENTITY, bytesToHex$1(opts.entityId)],
		[TAG_EVERSION, opts.version.toString()]
	];
	if (opts.prevHash) tags.push([TAG_EPREV, bytesToHex$1(opts.prevHash)]);
	if (opts.authority) tags.push(citationToTag(opts.authority));
	return buildRumor({
		kind: KIND_CONTROL,
		content: opts.content,
		tags,
		pubkey: opts.actorPubkey,
		ms: null,
		createdAtSecs: opts.createdAtSecs
	});
}
var EditionError = class extends Error {
	code;
	constructor(code, message) {
		super(message);
		this.code = code;
		this.name = "EditionError";
	}
};
function decodeHash(hex, field) {
	if (!hex || !HEX64.test(hex)) throw new EditionError("bad-field", field);
	return hexToBytes$1(hex.toLowerCase());
}
/**
* Parse an OPENED control stream event into an edition. The stream layer
* already proved authorship (seal signature) and rumor integrity (id hash);
* this extracts the edition machinery and computes selfHash. Rejects duplicate
* machinery tags (which would make the canonical bytes ambiguous). Does NOT
* check roster authorization — that's the fold's separate step.
*/
function parseEdition(opened) {
	if (opened.kind !== 3308) throw new EditionError("bad-field", "kind");
	if (opened.sealKind !== 20014) throw new EditionError("bad-field", "seal-kind");
	for (const name of [
		TAG_SUBKIND,
		TAG_ENTITY,
		TAG_EVERSION,
		TAG_EPREV,
		TAG_CITATION
	]) if (opened.tags.filter((t) => t[0] === name).length > 1) throw new EditionError("bad-field", `duplicate tag: ${name}`);
	const get = (name) => opened.tags.find((t) => t[0] === name)?.[1];
	const vsk = get(TAG_SUBKIND);
	if (vsk === void 0) throw new EditionError("missing-field", "vsk");
	const entityId = decodeHash(get(TAG_ENTITY), "eid");
	const evStr = get(TAG_EVERSION);
	if (evStr === void 0) throw new EditionError("missing-field", "ev");
	if (!/^\d+$/.test(evStr)) throw new EditionError("bad-field", "ev");
	const version = BigInt(evStr);
	const epStr = get(TAG_EPREV);
	const prevHash = epStr !== void 0 ? decodeHash(epStr, "ep") : void 0;
	const selfHash = editionHash(entityId, version, prevHash, new TextEncoder().encode(opened.content));
	return {
		author: opened.author,
		vsk,
		entityId,
		version,
		prevHash,
		content: opened.content,
		selfHash,
		createdAt: opened.createdAt,
		rumorId: hexToBytes$1(opened.rumorId),
		authority: citationFromTags(opened.tags),
		opened
	};
}
/** The `version.Edition` view used by `version.fold`. */
function toFoldEdition(p) {
	return {
		version: p.version,
		prevHash: p.prevHash,
		selfHash: p.selfHash,
		createdAt: p.createdAt,
		tiebreakId: p.rumorId
	};
}
//#endregion
//#region src/concord-v2/lib/roles.ts
/**
* Concord V2 roles & permissions — CORD-04.
*
* Two kinds of permission, enforced two ways: READ access is key possession
* (never a permission bit); WRITE authority is a member's rank in the
* owner-rooted Roster. Bit positions are FROZEN wire format. `permissions`
* rides the wire as a DECIMAL STRING (a JSON number is a float in JS and
* silently corrupts past 2^53); a reader accepts either form, always writes
* the string.
*/
const Permissions = {
	MANAGE_ROLES: 1n << 0n,
	MANAGE_CHANNELS: 1n << 1n,
	MANAGE_METADATA: 1n << 2n,
	KICK: 1n << 3n,
	BAN: 1n << 4n,
	MANAGE_MESSAGES: 1n << 5n,
	CREATE_INVITE: 1n << 6n,
	VIEW_AUDIT_LOG: 1n << 8n,
	MENTION_EVERYONE: 1n << 9n
};
(Permissions.MANAGE_ROLES | Permissions.MANAGE_CHANNELS | Permissions.MANAGE_METADATA | Permissions.KICK | Permissions.BAN | Permissions.MANAGE_MESSAGES | Permissions.CREATE_INVITE | Permissions.VIEW_AUDIT_LOG | Permissions.MENTION_EVERYONE) & ~Permissions.MENTION_EVERYONE;
function permsContain(perms, bits) {
	return (perms & bits) === bits;
}
Permissions.MANAGE_ROLES, Permissions.MANAGE_CHANNELS, Permissions.MANAGE_METADATA, Permissions.KICK, Permissions.BAN, Permissions.MANAGE_MESSAGES, Permissions.CREATE_INVITE, Permissions.MENTION_EVERYONE;
Permissions.KICK | Permissions.BAN | Permissions.MANAGE_MESSAGES | Permissions.MENTION_EVERYONE;
function roleFromJSON(json) {
	try {
		const w = JSON.parse(json);
		if (typeof w.role_id !== "string" || !/^[0-9a-f]{64}$/i.test(w.role_id)) return void 0;
		let permissions;
		if (typeof w.permissions === "string" && /^\d+$/.test(w.permissions)) permissions = BigInt(w.permissions);
		else if (typeof w.permissions === "number" && Number.isFinite(w.permissions)) permissions = BigInt(Math.trunc(w.permissions));
		else return void 0;
		if (typeof w.position !== "number" || !Number.isInteger(w.position) || w.position < 1) return;
		const name = typeof w.name === "string" ? w.name : "";
		if (new TextEncoder().encode(name).length > 64) return void 0;
		const scope = w.scope?.kind === "channel" && typeof w.scope.channel_id === "string" ? {
			kind: "channel",
			channelId: w.scope.channel_id
		} : { kind: "server" };
		return {
			roleId: w.role_id.toLowerCase(),
			name,
			position: w.position,
			permissions,
			scope,
			color: typeof w.color === "number" ? w.color : 0
		};
	} catch {
		return;
	}
}
function grantFromJSON(json) {
	try {
		const w = JSON.parse(json);
		if (typeof w.member !== "string" || !/^[0-9a-f]{64}$/i.test(w.member)) return void 0;
		const roleIds = Array.isArray(w.role_ids) ? w.role_ids.filter((r) => typeof r === "string").slice(0, 64) : [];
		return {
			member: w.member.toLowerCase(),
			roleIds
		};
	} catch {
		return;
	}
}
function emptyRoles() {
	return {
		roles: [],
		grants: []
	};
}
function roleById(roles, roleId) {
	return roles.roles.find((r) => r.roleId === roleId);
}
function rolesOf(roles, memberHex) {
	const out = [];
	for (const g of roles.grants) {
		if (g.member !== memberHex) continue;
		for (const rid of g.roleIds) {
			const r = roleById(roles, rid);
			if (r) out.push(r);
		}
	}
	return out;
}
function effectivePermissions(roles, memberHex) {
	return rolesOf(roles, memberHex).reduce((acc, r) => acc | r.permissions, 0n);
}
function hasPermission(roles, memberHex, bits) {
	return permsContain(effectivePermissions(roles, memberHex), bits);
}
/** A member's rank: the lowest position among their Roles; undefined if roleless. */
function highestPosition(roles, memberHex) {
	const positions = rolesOf(roles, memberHex).map((r) => r.position);
	return positions.length ? Math.min(...positions) : void 0;
}
/** Owner is supreme; otherwise the actor must hold `permission`. */
function isAuthorized(roles, actorHex, ownerHex, permission) {
	if (ownerHex === actorHex) return true;
	return hasPermission(roles, actorHex, permission);
}
/** Does the actor STRICTLY outrank `targetPosition`? Owner outranks everything. */
function outranks(roles, actorHex, ownerHex, targetPosition) {
	if (ownerHex === actorHex) return true;
	const p = highestPosition(roles, actorHex);
	return p !== void 0 && p < targetPosition;
}
/** May `actorHex` perform an action requiring `permission` against a target at `targetPosition`? */
function canActOnPosition(roles, actorHex, ownerHex, targetPosition, permission) {
	if (ownerHex === actorHex) return true;
	return hasPermission(roles, actorHex, permission) && outranks(roles, actorHex, ownerHex, targetPosition);
}
//#endregion
//#region src/concord-v2/lib/control.ts
/** Every control-plane stream key across the community's held root epochs, newest first. */
function controlGroups(community) {
	return community.heldRoots.map((r) => controlGroupKey(r.key, community.id, r.epoch));
}
/** The CURRENT control-plane stream key (where new editions publish). */
function currentControlGroup(community) {
	return controlGroupKey(community.root, community.id, community.rootEpoch);
}
/** Sign (plaintext seal) + wrap one edition rumor for the control stream. */
async function sealEdition(rumor, control, signer) {
	return wrapSeal(await sealRumor(rumor, KIND_SEAL_PLAINTEXT, control, signer), control);
}
/**
* Decode-once memo for opened+parsed control editions, keyed by wrap id. The
* roster/metadata/banlist consumers re-fold on every mount and poll; a wrap's
* decryption + seal verify is immutable, so parse each exactly once per
* session. `null` remembers a failure (not ours / malformed) so it isn't
* retried either.
*/
const parsedEditionMemo = /* @__PURE__ */ new Map();
/** Open every control wrap that decodes under one of `groups` into editions. */
function openControlWraps(wraps, groups) {
	const byPk = new Map(groups.map((g) => [g.pk, g]));
	const out = [];
	for (const wrap of wraps) {
		const cached = parsedEditionMemo.get(wrap.id);
		if (cached !== void 0) {
			if (cached) out.push(cached);
			continue;
		}
		const group = byPk.get(wrap.pubkey);
		if (!group) continue;
		let parsed = null;
		try {
			parsed = parseEdition(openWrap(wrap, group));
		} catch {
			parsed = null;
		}
		parsedEditionMemo.set(wrap.id, parsed);
		if (parsed) out.push(parsed);
	}
	return out;
}
/** Community metadata (vsk 0); eid = the community_id. Gated by MANAGE_METADATA. */
function buildMetadataEdition(communityId, metadata, o) {
	if (utf8Len(metadata.name) > 64) throw new Error(`community name exceeds 64 bytes`);
	if (metadata.description !== void 0 && utf8Len(metadata.description) > 1e4) throw new Error(`description exceeds ${DESCRIPTION_MAX_BYTES} bytes`);
	return buildEditionRumor({
		vsk: "0",
		entityId: communityId,
		content: JSON.stringify(metadata),
		...o
	});
}
/** Channel metadata (vsk 2); eid = the channel_id. Gated by MANAGE_CHANNELS. */
function buildChannelEdition(channelId, metadata, o) {
	if (utf8Len(metadata.name) > 64) throw new Error(`channel name exceeds 64 bytes`);
	return buildEditionRumor({
		vsk: "2",
		entityId: channelId,
		content: JSON.stringify(metadata),
		...o
	});
}
/** Invite Registry (vsk 8); eid = invite_links_locator(cid, creator). Locators only. */
function buildRegistryEdition(communityId, creatorHex, linkSigners, o) {
	return buildEditionRumor({
		vsk: "8",
		entityId: inviteLinksLocator(communityId, hex32(creatorHex)),
		content: JSON.stringify(linkSigners),
		...o
	});
}
function pushEdition(m, key, p) {
	const list = m.get(key);
	if (list) list.push(p);
	else m.set(key, [p]);
}
/**
* Fold one entity's editions into an ORDERED candidate list:
*
*   1. the chain-verified fold head first (refuse-downgrade, contiguity — the
*      steady-state answer, and the compaction case too: a re-wrapped head
*      with a dangling `prev` is still the lowest-anchored walk's top);
*   2. then EVERY remaining edition, version-DESCENDING (equal versions by
*      rumor id, the fold's tiebreak winner first) — the candidates a client
*      may accept when (and only when) a higher-priority candidate fails the
*      caller's authority gate. "The highest authority-verified head"
*      (CORD-04 §1) requires gating before choosing, or a forger could
*      suppress a legit entity with garbage at a higher (or dangling lower)
*      version.
*
* Equal-version fork SIBLINGS are all kept: the tiebreak (lower rumor id) is
* grindable, so evicting the loser here would let an id-mined fork of the
* chain tip suppress the real edition before any authority gate ever saw it
* (an unauthorized banlist fork emptying the banlist, a low-rank grant fork
* revoking an admin). The tiebreak orders siblings; the gate decides.
*
* The caller picks the first candidate that passes its gate and records it in
* `heads`.
*
* `floor` is a TRACKING client's last-accepted head for this entity (from the
* prior fold's snapshot). When present and the served editions don't link
* contiguously up to it (a hostile relay withholding the middle of the chain),
* the fold reports a GAP: a synced client must fail closed and NOT downgrade to
* the dangling head (CORD-04 §1). We drop every candidate strictly above the
* floor in that case, so the entity holds at its last-known-good head and
* refetches. A FRESH joiner (no floor) still accepts the highest head despite a
* dangling `prev` — that is the legitimate compaction bootstrap.
*
* `snapshot` is the subset of editions wrapped under the CURRENT epoch's
* control group, passed once the community has Refounded at least once. A
* Refounding compacts every head into the new epoch (CORD-06 §3), so the
* current epoch is self-contained and readable-but-superseded fragments from
* older epochs must not outrank it. The snapshot folds by BOOTSTRAP
* (highest signed version, floor as version-only refuse-downgrade), NEVER the
* chain walk: behind a compaction, dangling `prev`s are normal, and — since
* seal signatures survive re-wrap — any group-key holder can re-serve a real
* OLD edition under the current group. Version anchoring is what bounds that:
* a re-wrap cannot raise the version inside the signed seal, so a re-served
* stale edition always loses to the compacted head. Old-epoch editions remain
* fallback candidates for the authority gate.
*/
function headCandidates(editions, floor, snapshot, onGap) {
	const ordered = [];
	const seenRumors = /* @__PURE__ */ new Set();
	let gapped = false;
	if (snapshot) {
		const idx = bootstrapHead(editions.map(toFoldEdition), floor?.version ?? 0n);
		if (idx !== null) {
			ordered.push(editions[idx]);
			seenRumors.add(bytesToHex$1(editions[idx].rumorId));
		} else if (floor !== void 0) {
			gapped = true;
			onGap?.();
		}
	} else {
		const result = fold(editions.map(toFoldEdition), floor?.version ?? 0n, floor?.hash);
		gapped = floor !== void 0 && result.gap;
		if (gapped) onGap?.();
		if (result.head !== null && !gapped) {
			ordered.push(editions[result.head]);
			seenRumors.add(bytesToHex$1(editions[result.head].rumorId));
		}
	}
	const rest = editions.filter((e) => {
		const id = bytesToHex$1(e.rumorId);
		if (seenRumors.has(id)) return false;
		seenRumors.add(id);
		if (gapped && e.version > floor.version) return false;
		return true;
	}).sort((a, b) => {
		if (a.version !== b.version) return a.version > b.version ? -1 : 1;
		return bytesToHex$1(a.rumorId) < bytesToHex$1(b.rumorId) ? -1 : 1;
	});
	ordered.push(...rest);
	return ordered;
}
/** Pick the first candidate passing `gate`; record it as the entity's head. */
function pickHead(candidates, heads, headEditions, gate) {
	for (const p of candidates) {
		if (!gate(p)) continue;
		heads.set(bytesToHex$1(p.entityId), {
			version: p.version,
			hash: p.selfHash
		});
		headEditions.set(bytesToHex$1(p.entityId), p);
		return p;
	}
}
/** Order role/grant candidates oldest version first (the admissibility walk). */
function byVersionAsc(a, b) {
	return a.parsed.version < b.parsed.version ? -1 : a.parsed.version > b.parsed.version ? 1 : 0;
}
/** Version-ascending groups; equal-version fork siblings share a group. */
function versionGroups(candidates) {
	const groups = [];
	for (const c of [...candidates].sort(byVersionAsc)) {
		const last = groups[groups.length - 1];
		if (last && last[0].parsed.version === c.parsed.version) last.push(c);
		else groups.push([c]);
	}
	return groups;
}
/**
* The delegation fixpoint (CORD-04 §2): start with the owner authorized (their
* rank comes from the community_id, not any fold), then admit role/grant
* entities whose signer is authorized to make them, repeating until stable.
* Per entity the ORDERED candidates are tried in turn and the first authorized
* one settles it, so a forger's garbage edition can't suppress a legit head.
* Anything whose signer never becomes authorized is dropped (the
* self-promotion / forged-delegation defense).
*
* Editing is ACTING ON A TARGET (CORD-04 §5): besides outranking what an
* edition hands out, a non-owner signer must strictly outrank what it REPLACES
* — the standing role position, or the rank a grant's predecessor conferred —
* or a revoke (empty role_ids) / demotion would be free to anyone. Each
* entity's candidates are walked version-ascending so the "standing" state is
* itself an admissible edition, never a forger's plant. Equal-version fork
* siblings settle to ONE winner per version, highest authority first — the
* grindable rumor-id tiebreak never lets a lower rank evict its superior's
* edition.
*
* The fold must be a function of the edition SET, never its arrival order:
* entities are processed in sorted-eid order, and an entity DEFERS while any
* state its gate reads is still pending — a handed-out role definition, or a
* candidate author's own rank source (their grant entity). A stalled fixpoint
* freezes those deferrals one at a time (a still-pending dependency is then
* provably dead or cyclic), so it always terminates.
*/
function authorizeDelegation(roleCandidates, grantCandidates, ownerHex, heads, headEditions) {
	const roster = emptyRoles();
	const settledRoles = /* @__PURE__ */ new Set();
	const settledGrants = /* @__PURE__ */ new Set();
	const roleEids = [...roleCandidates.keys()].sort();
	const grantEids = [...grantCandidates.keys()].sort();
	const grantEidOfMember = /* @__PURE__ */ new Map();
	for (const [eid, cands] of grantCandidates) if (cands.length > 0) grantEidOfMember.set(cands[0].grant.member, eid);
	let changed = true;
	let rolesFrozen = false;
	let ranksFrozen = false;
	const settle = (p) => {
		heads.set(bytesToHex$1(p.entityId), {
			version: p.version,
			hash: p.selfHash
		});
		headEditions.set(bytesToHex$1(p.entityId), p);
	};
	/** Is a non-owner author's rank still undetermined (their grant entity pending)? */
	const rankPending = (author, selfEid) => {
		if (author === ownerHex) return false;
		const aeid = grantEidOfMember.get(author);
		return aeid !== void 0 && aeid !== selfEid && !settledGrants.has(aeid);
	};
	/**
	* Equal-version fork siblings, highest authority first: the owner, then rank
	* (lower position), then the fold's rumor-id tiebreak. The id is grindable;
	* authority is not — so a fork can only displace an edition its author could
	* have overwritten anyway.
	*/
	const authorityFirst = (a, b) => {
		const rank = (author) => author === ownerHex ? -1 : highestPosition(roster, author) ?? Number.MAX_SAFE_INTEGER;
		const ra = rank(a.author);
		const rb = rank(b.author);
		if (ra !== rb) return ra - rb;
		const ia = bytesToHex$1(a.parsed.rumorId);
		const ib = bytesToHex$1(b.parsed.rumorId);
		return ia < ib ? -1 : ia > ib ? 1 : 0;
	};
	while (changed) {
		changed = false;
		for (const eid of roleEids) {
			if (settledRoles.has(eid)) continue;
			const candidates = roleCandidates.get(eid);
			if (!ranksFrozen && candidates.some((c) => rankPending(c.author))) continue;
			const admissible = /* @__PURE__ */ new Set();
			let standing;
			for (const group of versionGroups(candidates)) for (const { role, author, parsed } of [...group].sort(authorityFirst)) {
				const mintOk = author === ownerHex || canActOnPosition(roster, author, ownerHex, role.position, Permissions.MANAGE_ROLES);
				const replaceOk = author === ownerHex || standing === void 0 || outranks(roster, author, ownerHex, standing);
				if (!mintOk || !replaceOk) continue;
				admissible.add(parsed);
				standing = role.position;
				break;
			}
			const pick = candidates.find((c) => admissible.has(c.parsed));
			if (!pick) continue;
			roster.roles.push(pick.role);
			settledRoles.add(eid);
			settle(pick.parsed);
			changed = true;
		}
		for (const eid of grantEids) {
			if (settledGrants.has(eid)) continue;
			const candidates = grantCandidates.get(eid);
			const rolePending = (rid) => roleCandidates.has(rid) && !settledRoles.has(rid);
			if (!rolesFrozen && candidates.some((c) => c.grant.roleIds.some(rolePending))) continue;
			if (!ranksFrozen && candidates.some((c) => rankPending(c.author, eid))) continue;
			const admissible = /* @__PURE__ */ new Set();
			let standing;
			for (const group of versionGroups(candidates)) for (const { grant, author, parsed } of [...group].sort(authorityFirst)) {
				const positions = grant.roleIds.map((rid) => roster.roles.find((r) => r.roleId === rid)?.position).filter((p) => p !== void 0);
				const allKnown = positions.length === grant.roleIds.length;
				if (!(author === ownerHex || allKnown && hasPermission(roster, author, Permissions.MANAGE_ROLES) && positions.every((pos) => outranks(roster, author, ownerHex, pos)) && (standing === void 0 || outranks(roster, author, ownerHex, standing)))) continue;
				admissible.add(parsed);
				standing = positions.length ? Math.min(...positions) : void 0;
				break;
			}
			const pick = candidates.find((c) => admissible.has(c.parsed));
			if (!pick) continue;
			roster.grants.push(pick.grant);
			settledGrants.add(eid);
			settle(pick.parsed);
			changed = true;
		}
		if (!changed && !rolesFrozen) {
			rolesFrozen = true;
			changed = true;
		} else if (!changed && !ranksFrozen) {
			ranksFrozen = true;
			changed = true;
		}
	}
	if (roster.roles.length > 100) {
		roster.roles.sort((a, b) => a.roleId < b.roleId ? -1 : a.roleId > b.roleId ? 1 : 0);
		roster.roles = roster.roles.slice(0, 100);
	}
	return roster;
}
/** Fold-once memo, keyed on the community + the exact edition set. */
const foldMemo = /* @__PURE__ */ new Map();
/**
* Replay a set of opened control editions into current state. `ownerHex` is
* the community's proven owner (verified against the id commitment when the
* membership entry was accepted).
*
* Runs in up to two passes: the first fold resolves the Banlist (itself
* roster-gated), and if any edition was authored by a banned npub the fold
* re-runs with those editions excluded — a banned npub's authority actions are
* dropped like every other event of theirs (CORD-04 §4). The first pass's
* Banlist stays the final word (the owner is never bannable, so the anti-
* roster can't be used to erase itself).
*/
function foldControlState(editions, communityId, ownerHex, priorHeads, snapshotIds) {
	const cidHex = bytesToHex$1(communityId);
	const memoKey = `${cidHex}:${ownerHex}:${priorHeads ? [...priorHeads.entries()].map(([k, v]) => `${k}@${v.version}`).sort().join(",") : ""}:${snapshotIds ? [...snapshotIds].sort().join(",") : ""}:${editions.map((e) => e.opened.wrapId).sort().join(",")}`;
	const hit = foldMemo.get(memoKey);
	if (hit) return hit;
	const first = foldOnce(editions, communityId, ownerHex, priorHeads, snapshotIds);
	let result = first;
	const banned = new Set([...first.banned].filter((pk) => pk !== ownerHex));
	if (banned.size > 0 && editions.some((e) => banned.has(e.author))) result = {
		...foldOnce(editions.filter((e) => !banned.has(e.author)), communityId, ownerHex, priorHeads, snapshotIds),
		banned: first.banned,
		bannedAt: first.bannedAt,
		incomplete: first.incomplete
	};
	for (const k of foldMemo.keys()) if (k.startsWith(`${cidHex}:`)) foldMemo.delete(k);
	foldMemo.set(memoKey, result);
	return result;
}
function foldOnce(editions, communityId, ownerHex, priorHeads, snapshotIds) {
	const cidHex = bytesToHex$1(communityId);
	const byVsk = /* @__PURE__ */ new Map();
	for (const p of editions) {
		let m = byVsk.get(p.vsk);
		if (!m) byVsk.set(p.vsk, m = /* @__PURE__ */ new Map());
		pushEdition(m, bytesToHex$1(p.entityId), p);
	}
	const heads = /* @__PURE__ */ new Map();
	const headEditions = /* @__PURE__ */ new Map();
	const gapHeld = /* @__PURE__ */ new Set();
	/** Ordered head candidates per entity of one vsk (floored per prior head). */
	const candidatesOf = (vsk) => {
		const out = /* @__PURE__ */ new Map();
		for (const [eid, list] of byVsk.get(vsk) ?? /* @__PURE__ */ new Map()) {
			const snap = snapshotIds ? list.filter((p) => snapshotIds.has(bytesToHex$1(p.rumorId))) : [];
			out.set(eid, headCandidates(list, priorHeads?.get(eid), snap.length > 0 ? snap : void 0, () => gapHeld.add(eid)));
		}
		return out;
	};
	const roleCandidates = /* @__PURE__ */ new Map();
	for (const [eid, candidates] of candidatesOf("1")) {
		const parsed = candidates.map((p) => ({
			role: roleFromJSON(p.content),
			author: p.author,
			parsed: p
		})).filter((c) => Boolean(c.role && bytesToHex$1(hex32(c.role.roleId)) === eid));
		if (parsed.length > 0) roleCandidates.set(eid, parsed);
	}
	const grantCandidates = /* @__PURE__ */ new Map();
	for (const [eid, candidates] of candidatesOf("3")) {
		const parsed = candidates.map((p) => ({
			grant: grantFromJSON(p.content),
			author: p.author,
			parsed: p
		})).filter((c) => Boolean(c.grant && bytesToHex$1(grantLocator(communityId, hex32(c.grant.member))) === eid));
		if (parsed.length > 0) grantCandidates.set(eid, parsed);
	}
	const roster = authorizeDelegation(roleCandidates, grantCandidates, ownerHex, heads, headEditions);
	const grantEditionIndex = /* @__PURE__ */ new Map();
	for (const [eid, cands] of grantCandidates) {
		const byVer = /* @__PURE__ */ new Map();
		for (const c of cands) {
			const v = c.parsed.version.toString();
			let s = byVer.get(v);
			if (!s) byVer.set(v, s = /* @__PURE__ */ new Set());
			s.add(bytesToHex$1(c.parsed.selfHash));
		}
		grantEditionIndex.set(eid, byVer);
	}
	const citationOk = (p) => {
		if (p.author === ownerHex) return true;
		const vac = p.authority;
		if (!vac) return false;
		const expectedEid = bytesToHex$1(grantLocator(communityId, hex32(p.author)));
		if (bytesToHex$1(vac.entityId) !== expectedEid) return false;
		const hashes = grantEditionIndex.get(expectedEid)?.get(vac.version.toString());
		return hashes !== void 0 && hashes.has(bytesToHex$1(vac.editionHash));
	};
	let metadata;
	{
		const head = pickHead(candidatesOf("0").get(cidHex) ?? [], heads, headEditions, (p) => {
			if (!isAuthorized(roster, p.author, ownerHex, Permissions.MANAGE_METADATA)) return false;
			if (!citationOk(p)) return false;
			try {
				const parsed = JSON.parse(p.content);
				if (typeof parsed.name !== "string" || utf8Len(parsed.name) > 64) return false;
				if (parsed.description !== void 0 && (typeof parsed.description !== "string" || utf8Len(parsed.description) > 1e4)) return false;
				if (parsed.repo_naddr !== void 0 && (typeof parsed.repo_naddr !== "string" || utf8Len(parsed.repo_naddr) > 2048)) return false;
				return true;
			} catch {
				return false;
			}
		});
		if (head) {
			const parsed = JSON.parse(head.content);
			metadata = {
				...parsed,
				relays: capRelays(Array.isArray(parsed.relays) ? parsed.relays : []),
				icon: isImagePointer(parsed.icon) ? parsed.icon : void 0,
				banner: isImagePointer(parsed.banner) ? parsed.banner : void 0
			};
		}
	}
	const channels = /* @__PURE__ */ new Map();
	for (const [eid, candidates] of candidatesOf("2")) {
		const head = pickHead(candidates, heads, headEditions, (p) => {
			if (!isAuthorized(roster, p.author, ownerHex, Permissions.MANAGE_CHANNELS)) return false;
			if (!citationOk(p)) return false;
			try {
				const meta = JSON.parse(p.content);
				return typeof meta.name === "string" && meta.name.length > 0 && utf8Len(meta.name) <= 64;
			} catch {
				return false;
			}
		});
		if (!head) continue;
		const meta = JSON.parse(head.content);
		channels.set(eid, {
			channelIdHex: eid,
			name: meta.name,
			isPrivate: meta.private === true,
			deleted: meta.deleted === true
		});
	}
	const banned = /* @__PURE__ */ new Set();
	const bannedAt = /* @__PURE__ */ new Map();
	{
		const eid = bytesToHex$1(banlistLocator(communityId));
		const candidates = candidatesOf("4").get(eid) ?? [];
		const banlistGate = (p) => {
			if (!isAuthorized(roster, p.author, ownerHex, Permissions.BAN)) return false;
			if (!citationOk(p)) return false;
			try {
				return Array.isArray(JSON.parse(p.content));
			} catch {
				return false;
			}
		};
		const head = pickHead(candidates, heads, headEditions, banlistGate);
		if (head) {
			for (const pk of JSON.parse(head.content)) if (typeof pk === "string" && /^[0-9a-f]{64}$/i.test(pk)) banned.add(pk.toLowerCase());
		}
		for (const p of candidates) {
			if (!banlistGate(p)) continue;
			let list;
			try {
				list = JSON.parse(p.content);
			} catch {
				continue;
			}
			if (!Array.isArray(list)) continue;
			for (const pk of list) {
				if (typeof pk !== "string" || !/^[0-9a-f]{64}$/i.test(pk)) continue;
				const k = pk.toLowerCase();
				if (k === ownerHex) continue;
				const prev = bannedAt.get(k);
				if (prev === void 0 || p.createdAt > prev) bannedAt.set(k, p.createdAt);
			}
		}
	}
	const liveInviteLinks = /* @__PURE__ */ new Set();
	const registriesByCreator = /* @__PURE__ */ new Map();
	for (const [eid, candidates] of candidatesOf("8")) {
		const head = pickHead(candidates, heads, headEditions, (p) => {
			if (bytesToHex$1(inviteLinksLocator(communityId, hex32(p.author))) !== eid) return false;
			if (!isAuthorized(roster, p.author, ownerHex, Permissions.CREATE_INVITE)) return false;
			if (!citationOk(p)) return false;
			try {
				return Array.isArray(JSON.parse(p.content));
			} catch {
				return false;
			}
		});
		if (!head) continue;
		const list = JSON.parse(head.content).filter((s) => typeof s === "string" && /^[0-9a-f]{64}$/i.test(s));
		registriesByCreator.set(head.author, list);
		for (const pk of list) liveInviteLinks.add(pk.toLowerCase());
	}
	const servedEids = /* @__PURE__ */ new Set();
	for (const m of byVsk.values()) for (const eid of m.keys()) servedEids.add(eid);
	const incomplete = [...gapHeld];
	for (const eid of priorHeads?.keys() ?? []) if (!servedEids.has(eid) && !gapHeld.has(eid)) incomplete.push(eid);
	return {
		roster,
		ownerHex,
		metadata,
		channels,
		banned,
		bannedAt,
		liveInviteLinks,
		registriesByCreator,
		heads,
		headEditions,
		incomplete
	};
}
"0".repeat(64);
//#endregion
//#region src/concord-v2/lib/agentGate.ts
/**
* Agent gate (CORD-02 §1 extension): an opt-in "block humans" flag a creator
* seals into the Community metadata at genesis.
*
* A gated ₿AO requires every Guestbook Join rumor to carry NIP-13-style
* proof-of-work (the rumor id's leading zero bits ≥ `difficulty`) — a captcha
* only agents solve: tooling grinds it in seconds, the human app UI refuses.
* Every conforming client drops sub-difficulty joins from the roster fold, so
* the gate holds network-wide, not just in one app.
*
* Honest scope: PoW proves WORK, not non-humanity — a determined human with
* scripts can compute it. The gate keeps casual humans out of agent spaces;
* it is not an identity boundary. Reading public channels still only requires
* the invite bundle; the gate governs the member roster (who "entered").
*/
/** The metadata key carrying the gate (top-level, round-tripped by editors). */
const AGENT_GATE_METADATA_KEY = "agent_gate";
/** Read + validate the gate from folded Community metadata. */
function agentGateOf(metadata) {
	const raw = metadata?.[AGENT_GATE_METADATA_KEY];
	if (raw === null || raw === void 0 || typeof raw !== "object") return void 0;
	const gate = raw;
	if (gate.type !== "pow") return void 0;
	const difficulty = gate.difficulty;
	if (typeof difficulty !== "number" || !Number.isInteger(difficulty) || difficulty < 1 || difficulty > 28) return;
	return {
		type: "pow",
		difficulty
	};
}
/** NIP-13: count leading zero BITS of a 32-byte hex id. */
function countLeadingZeroBits(idHex) {
	let bits = 0;
	for (const ch of idHex) {
		const nibble = parseInt(ch, 16);
		if (Number.isNaN(nibble)) return 0;
		if (nibble === 0) {
			bits += 4;
			continue;
		}
		return bits + (nibble < 2 ? 3 : nibble < 4 ? 2 : nibble < 8 ? 1 : 0);
	}
	return bits;
}
/** Does this rumor id satisfy the gate? */
function meetsJoinPow(rumorIdHex, difficulty) {
	return countLeadingZeroBits(rumorIdHex) >= difficulty;
}
/**
* Attempt budget for a grind: 2^(d+4) = 16× the expected work, so a VALID
* gate fails only with probability e^-16 (~1e-7). A flat cap breaks the
* contract at the top of the legal range — 2^26 attempts vs difficulty 26-28
* means a legitimate gate is refused 37-78% of the time (expected work is
* 2^d). Difficulty is already range-checked by agentGateOf (≤28), so the
* budget is ≤ 2^32 — slow by the owner's own choice, never an infinite hang.
*/
function powAttemptBudget(difficulty) {
	return 2 ** (difficulty + 4);
}
/**
* Grind a Join rumor until its id carries the required PoW. The send time
* stays fresh; a NIP-13 `nonce` tag (with the committed difficulty) varies.
*/
function grindJoinRumor(pubkey, ms, difficulty, attribution) {
	const baseTags = [];
	if (attribution) {
		const tag = [
			"invite",
			attribution.creator,
			attribution.label ?? ""
		];
		if (attribution.commitment) tag.push(attribution.commitment);
		baseTags.push(tag);
	}
	for (let counter = 0;; counter++) {
		if (counter > powAttemptBudget(difficulty)) throw new Error(`proof-of-work grind exhausted the attempt budget at difficulty ${difficulty}`);
		const rumor = buildRumor({
			kind: KIND_JOIN_LEAVE,
			content: "join",
			tags: [...baseTags, [
				"nonce",
				String(counter),
				String(difficulty)
			]],
			pubkey,
			ms
		});
		if (meetsJoinPow(rumor.id, difficulty)) return rumor;
	}
}
//#endregion
//#region src/concord-v2/lib/guestbook.ts
/** The CURRENT guestbook stream key (where new entries publish). */
function currentGuestbookGroup(community) {
	return guestbookGroupKey(community.root, community.id, community.rootEpoch);
}
/** A self-signed Join, optionally attributing the invite link used (CORD-05 §1). */
/**
* A self-signed Join. `attribution.commitment` is the sha256 of the invite
* link's unlock token ({@link inviteCommitment}) — it tells anyone folding the
* Guestbook which LINK the join came through (single-use enforcement, per-link
* key rotations) without revealing the token.
*/
function buildJoinRumor(pubkey, ms, attribution) {
	const tags = [];
	if (attribution) {
		const tag = [
			"invite",
			attribution.creator,
			attribution.label ?? ""
		];
		if (attribution.commitment) tag.push(attribution.commitment);
		tags.push(tag);
	}
	return buildRumor({
		kind: KIND_JOIN_LEAVE,
		content: "join",
		tags,
		pubkey,
		ms
	});
}
/** The invite-token commitment a Join rumor cites, if any (invite tag, 4th element). */
function joinCommitmentOf(ev) {
	if (ev.kind !== 3306 || ev.content !== "join") return void 0;
	const commitment = ev.tags.find((t) => t[0] === "invite")?.[3];
	return commitment && /^[0-9a-f]{64}$/.test(commitment) ? commitment : void 0;
}
/** Whether the Guestbook already shows a Join citing this invite commitment. */
function singleUseLinkUsed(opened, commitment) {
	return opened.some((ev) => joinCommitmentOf(ev) === commitment);
}
/** Sign (encrypted seal) + wrap one guestbook rumor. */
async function sealGuestbook(rumor, guestbook, signer) {
	return wrapSeal(await sealRumor(rumor, KIND_SEAL_ENCRYPTED, guestbook, signer), guestbook);
}
/** Open every guestbook wrap that decodes under one of `groups`. Memoized per wrap. */
const openedGuestbookMemo = /* @__PURE__ */ new Map();
function openGuestbookWraps(wraps, groups) {
	const byPk = new Map(groups.map((g) => [g.pk, g]));
	const out = [];
	for (const wrap of wraps) {
		const cached = openedGuestbookMemo.get(wrap.id);
		if (cached !== void 0) {
			if (cached) out.push(cached);
			continue;
		}
		const group = byPk.get(wrap.pubkey);
		if (!group) continue;
		let opened = null;
		try {
			opened = openWrap(wrap, group);
		} catch {
			opened = null;
		}
		openedGuestbookMemo.set(wrap.id, opened);
		if (opened) out.push(opened);
	}
	return out;
}
/**
* The Guestbook fold input when events are ALREADY opened (from the decrypted
* opened-event cache). The wrap decrypt happened at ingest; nothing to do but
* pass them through — kept as a named seam so the read path reads symmetrically
* with the control plane's `openControlEditions`.
*/
function openGuestbookOpened(opened) {
	return opened;
}
//#endregion
//#region node_modules/nostr-tools/lib/esm/pool.js
init_secp256k1();
init_utils$1();
init_sha2();
var verifiedSymbol$1 = Symbol("verified");
var isRecord$1 = (obj) => obj instanceof Object;
function validateEvent$1(event) {
	if (!isRecord$1(event)) return false;
	if (typeof event.kind !== "number") return false;
	if (typeof event.content !== "string") return false;
	if (typeof event.created_at !== "number") return false;
	if (typeof event.pubkey !== "string") return false;
	if (!event.pubkey.match(/^[a-f0-9]{64}$/)) return false;
	if (!Array.isArray(event.tags)) return false;
	for (let i2 = 0; i2 < event.tags.length; i2++) {
		let tag = event.tags[i2];
		if (!Array.isArray(tag)) return false;
		for (let j = 0; j < tag.length; j++) if (typeof tag[j] !== "string") return false;
	}
	return true;
}
new TextDecoder("utf-8");
var utf8Encoder$1 = new TextEncoder();
function normalizeURL$1(url) {
	try {
		if (url.indexOf("://") === -1) url = "wss://" + url;
		let p = new URL(url);
		if (p.protocol === "http:") p.protocol = "ws:";
		else if (p.protocol === "https:") p.protocol = "wss:";
		p.pathname = p.pathname.replace(/\/+/g, "/");
		if (p.pathname.endsWith("/")) p.pathname = p.pathname.slice(0, -1);
		if (p.port === "80" && p.protocol === "ws:" || p.port === "443" && p.protocol === "wss:") p.port = "";
		p.searchParams.sort();
		p.hash = "";
		return p.toString();
	} catch (e) {
		throw new Error(`Invalid URL: ${url}`);
	}
}
var JS$1 = class {
	generateSecretKey() {
		return schnorr$1.utils.randomSecretKey();
	}
	getPublicKey(secretKey) {
		return bytesToHex$2(schnorr$1.getPublicKey(secretKey));
	}
	finalizeEvent(t, secretKey) {
		const event = t;
		event.pubkey = bytesToHex$2(schnorr$1.getPublicKey(secretKey));
		event.id = getEventHash$1(event);
		event.sig = bytesToHex$2(schnorr$1.sign(hexToBytes$2(getEventHash$1(event)), secretKey));
		event[verifiedSymbol$1] = true;
		return event;
	}
	verifyEvent(event) {
		if (typeof event[verifiedSymbol$1] === "boolean") return event[verifiedSymbol$1];
		try {
			const hash = getEventHash$1(event);
			if (hash !== event.id) {
				event[verifiedSymbol$1] = false;
				return false;
			}
			const valid = schnorr$1.verify(hexToBytes$2(event.sig), hexToBytes$2(hash), hexToBytes$2(event.pubkey));
			event[verifiedSymbol$1] = valid;
			return valid;
		} catch (err) {
			event[verifiedSymbol$1] = false;
			return false;
		}
	}
};
function serializeEvent$1(evt) {
	if (!validateEvent$1(evt)) throw new Error("can't serialize event with wrong or missing properties");
	return JSON.stringify([
		0,
		evt.pubkey,
		evt.created_at,
		evt.kind,
		evt.tags,
		evt.content
	]);
}
function getEventHash$1(event) {
	return bytesToHex$2(sha256$1(utf8Encoder$1.encode(serializeEvent$1(event))));
}
var i$1 = new JS$1();
i$1.generateSecretKey;
i$1.getPublicKey;
i$1.finalizeEvent;
var verifyEvent$1 = i$1.verifyEvent;
var ClientAuth$1 = 22242;
function matchFilter(filter, event) {
	if (filter.ids && filter.ids.indexOf(event.id) === -1) return false;
	if (filter.kinds && filter.kinds.indexOf(event.kind) === -1) return false;
	if (filter.authors && filter.authors.indexOf(event.pubkey) === -1) return false;
	for (let f in filter) if (f[0] === "#") {
		let values = filter[`#${f.slice(1)}`];
		if (values && !event.tags.find(([t, v]) => t === f.slice(1) && values.indexOf(v) !== -1)) return false;
	}
	if (filter.since && event.created_at < filter.since) return false;
	if (filter.until && event.created_at > filter.until) return false;
	return true;
}
function matchFilters(filters, event) {
	for (let i2 = 0; i2 < filters.length; i2++) if (matchFilter(filters[i2], event)) return true;
	return false;
}
function getHex64$1(json, field) {
	let len = field.length + 3;
	let idx = json.indexOf(`"${field}":`) + len;
	let s = json.slice(idx).indexOf(`"`) + idx + 1;
	return json.slice(s, s + 64);
}
function getSubscriptionId$1(json) {
	let idx = json.slice(0, 22).indexOf(`"EVENT"`);
	if (idx === -1) return null;
	let pstart = json.slice(idx + 7 + 1).indexOf(`"`);
	if (pstart === -1) return null;
	let start = idx + 7 + 1 + pstart;
	let pend = json.slice(start + 1, 80).indexOf(`"`);
	if (pend === -1) return null;
	let end = start + 1 + pend;
	return json.slice(start + 1, end);
}
function makeAuthEvent$1(relayURL, challenge) {
	return {
		kind: ClientAuth$1,
		created_at: Math.floor(Date.now() / 1e3),
		tags: [["relay", relayURL], ["challenge", challenge]],
		content: ""
	};
}
var SendingOnClosedConnection = class extends Error {
	constructor(message, relay) {
		super(`Tried to send message '${message} on a closed connection to ${relay}.`);
		this.name = "SendingOnClosedConnection";
	}
};
var AbstractRelay = class {
	url;
	_connected = false;
	onclose = null;
	onnotice = (msg) => console.debug(`NOTICE from ${this.url}: ${msg}`);
	onauth;
	baseEoseTimeout = 4400;
	publishTimeout = 4400;
	pingFrequency = 29e3;
	pingTimeout = 2e4;
	resubscribeBackoff = [
		1e4,
		1e4,
		1e4,
		2e4,
		2e4,
		3e4,
		6e4
	];
	openSubs = /* @__PURE__ */ new Map();
	enablePing;
	enableReconnect;
	idleSince = Date.now();
	ongoingOperations = 0;
	reconnectTimeoutHandle;
	pingIntervalHandle;
	reconnectAttempts = 0;
	skipReconnection = false;
	connectionPromise;
	openCountRequests = /* @__PURE__ */ new Map();
	openEventPublishes = /* @__PURE__ */ new Map();
	ws;
	challenge;
	authPromise;
	serial = 0;
	verifyEvent;
	_WebSocket;
	constructor(url, opts) {
		this.url = normalizeURL$1(url);
		this.verifyEvent = opts.verifyEvent;
		this._WebSocket = opts.websocketImplementation || WebSocket;
		this.enablePing = opts.enablePing;
		this.enableReconnect = opts.enableReconnect || false;
	}
	static async connect(url, opts) {
		const relay = new AbstractRelay(url, opts);
		await relay.connect(opts);
		return relay;
	}
	closeAllSubscriptions(reason) {
		for (let [_, sub] of this.openSubs) sub.close(reason);
		this.openSubs.clear();
		for (let [_, ep] of this.openEventPublishes) ep.reject(new Error(reason));
		this.openEventPublishes.clear();
		for (let [_, cr] of this.openCountRequests) cr.reject(new Error(reason));
		this.openCountRequests.clear();
	}
	get connected() {
		return this._connected;
	}
	async reconnect() {
		const backoff = this.resubscribeBackoff[Math.min(this.reconnectAttempts, this.resubscribeBackoff.length - 1)];
		this.reconnectAttempts++;
		this.reconnectTimeoutHandle = setTimeout(async () => {
			try {
				await this.connect();
			} catch (err) {}
		}, backoff);
	}
	handleHardClose(reason) {
		if (this.pingIntervalHandle) {
			clearInterval(this.pingIntervalHandle);
			this.pingIntervalHandle = void 0;
		}
		this._connected = false;
		this.connectionPromise = void 0;
		this.idleSince = void 0;
		if (this.enableReconnect && !this.skipReconnection) this.reconnect();
		else {
			this.onclose?.();
			this.closeAllSubscriptions(reason);
		}
	}
	async connect(opts) {
		let connectionTimeoutHandle;
		if (this.connectionPromise) return this.connectionPromise;
		this.challenge = void 0;
		this.authPromise = void 0;
		this.skipReconnection = false;
		this.connectionPromise = new Promise((resolve, reject) => {
			if (opts?.timeout) connectionTimeoutHandle = setTimeout(() => {
				reject("connection timed out");
				this.connectionPromise = void 0;
				this.skipReconnection = true;
				this.onclose?.();
				this.handleHardClose("relay connection timed out");
			}, opts.timeout);
			if (opts?.abort) opts.abort.onabort = reject;
			try {
				this.ws = new this._WebSocket(this.url);
			} catch (err) {
				clearTimeout(connectionTimeoutHandle);
				reject(err);
				return;
			}
			this.ws.onopen = () => {
				if (this.reconnectTimeoutHandle) {
					clearTimeout(this.reconnectTimeoutHandle);
					this.reconnectTimeoutHandle = void 0;
				}
				clearTimeout(connectionTimeoutHandle);
				this._connected = true;
				const isReconnection = this.reconnectAttempts > 0;
				this.reconnectAttempts = 0;
				for (const sub of this.openSubs.values()) {
					sub.eosed = false;
					if (isReconnection) {
						for (let f = 0; f < sub.filters.length; f++) if (sub.lastEmitted) sub.filters[f].since = sub.lastEmitted + 1;
					}
					sub.fire();
				}
				if (this.enablePing) this.pingIntervalHandle = setInterval(() => this.pingpong(), this.pingFrequency);
				resolve();
			};
			this.ws.onerror = () => {
				clearTimeout(connectionTimeoutHandle);
				reject("connection failed");
				this.connectionPromise = void 0;
				this.skipReconnection = true;
				this.onclose?.();
				this.handleHardClose("relay connection failed");
			};
			this.ws.onclose = (ev) => {
				clearTimeout(connectionTimeoutHandle);
				reject(ev.message || "websocket closed");
				this.handleHardClose("relay connection closed");
			};
			this.ws.onmessage = this._onmessage.bind(this);
		});
		return this.connectionPromise;
	}
	waitForPingPong() {
		return new Promise((resolve) => {
			this.ws.once("pong", () => resolve(true));
			this.ws.ping();
		});
	}
	waitForDummyReq() {
		return new Promise((resolve, reject) => {
			if (!this.connectionPromise) return reject(/* @__PURE__ */ new Error(`no connection to ${this.url}, can't ping`));
			try {
				const sub = this.subscribe([{
					ids: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
					limit: 0
				}], {
					label: "<forced-ping>",
					oneose: () => {
						resolve(true);
						sub.close();
					},
					onclose() {
						resolve(true);
					},
					eoseTimeout: this.pingTimeout + 1e3
				});
			} catch (err) {
				reject(err);
			}
		});
	}
	async pingpong() {
		if (this.ws?.readyState === 1) {
			if (!await Promise.any([this.ws && this.ws.ping && this.ws.once ? this.waitForPingPong() : this.waitForDummyReq(), new Promise((res) => setTimeout(() => res(false), this.pingTimeout))])) {
				if (this.ws?.readyState === this._WebSocket.OPEN) this.ws?.close();
			}
		}
	}
	async send(message) {
		if (!this.connectionPromise) throw new SendingOnClosedConnection(message, this.url);
		this.connectionPromise.then(() => {
			this.ws?.send(message);
		});
	}
	async auth(signAuthEvent) {
		const challenge = this.challenge;
		if (!challenge) throw new Error("can't perform auth, no challenge was received");
		if (this.authPromise) return this.authPromise;
		this.authPromise = new Promise(async (resolve, reject) => {
			try {
				let evt = await signAuthEvent(makeAuthEvent$1(this.url, challenge));
				let timeout = setTimeout(() => {
					let ep = this.openEventPublishes.get(evt.id);
					if (ep) {
						ep.reject(/* @__PURE__ */ new Error("auth timed out"));
						this.openEventPublishes.delete(evt.id);
					}
				}, this.publishTimeout);
				this.openEventPublishes.set(evt.id, {
					resolve,
					reject,
					timeout
				});
				this.send("[\"AUTH\"," + JSON.stringify(evt) + "]");
			} catch (err) {
				console.warn("subscribe auth function failed:", err);
			}
		});
		return this.authPromise;
	}
	async publish(event) {
		this.idleSince = void 0;
		this.ongoingOperations++;
		const ret = new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				const ep = this.openEventPublishes.get(event.id);
				if (ep) {
					ep.reject(/* @__PURE__ */ new Error("publish timed out"));
					this.openEventPublishes.delete(event.id);
				}
			}, this.publishTimeout);
			this.openEventPublishes.set(event.id, {
				resolve,
				reject,
				timeout
			});
		});
		this.send("[\"EVENT\"," + JSON.stringify(event) + "]");
		this.ongoingOperations--;
		if (this.ongoingOperations === 0) this.idleSince = Date.now();
		return ret;
	}
	async count(filters, params) {
		this.serial++;
		const id = params?.id || "count:" + this.serial;
		const ret = new Promise((resolve, reject) => {
			this.openCountRequests.set(id, {
				resolve,
				reject
			});
		});
		this.send("[\"COUNT\",\"" + id + "\"," + JSON.stringify(filters).substring(1));
		return ret;
	}
	subscribe(filters, params) {
		if (params.label !== "<forced-ping>") {
			this.idleSince = void 0;
			this.ongoingOperations++;
		}
		const sub = this.prepareSubscription(filters, params);
		sub.fire();
		if (params.abort) params.abort.onabort = () => sub.close(String(params.abort.reason || "<aborted>"));
		return sub;
	}
	prepareSubscription(filters, params) {
		this.serial++;
		const id = params.id || (params.label ? params.label + ":" : "sub:") + this.serial;
		const sub = new Subscription(this, id, filters, params);
		this.openSubs.set(id, sub);
		return sub;
	}
	close() {
		this.skipReconnection = true;
		if (this.reconnectTimeoutHandle) {
			clearTimeout(this.reconnectTimeoutHandle);
			this.reconnectTimeoutHandle = void 0;
		}
		if (this.pingIntervalHandle) {
			clearInterval(this.pingIntervalHandle);
			this.pingIntervalHandle = void 0;
		}
		this.closeAllSubscriptions("relay connection closed by us");
		this._connected = false;
		this.idleSince = void 0;
		this.onclose?.();
		if (this.ws?.readyState === this._WebSocket.OPEN) this.ws?.close();
	}
	_onmessage(ev) {
		const json = ev.data;
		if (!json) return;
		const subid = getSubscriptionId$1(json);
		if (subid) {
			const so = this.openSubs.get(subid);
			if (!so) return;
			const id = getHex64$1(json, "id");
			const alreadyHave = so.alreadyHaveEvent?.(id);
			so.receivedEvent?.(this, id);
			if (alreadyHave) return;
		}
		try {
			let data = JSON.parse(json);
			switch (data[0]) {
				case "EVENT": {
					const so = this.openSubs.get(data[1]);
					const event = data[2];
					if (this.verifyEvent(event) && matchFilters(so.filters, event)) so.onevent(event);
					else so.oninvalidevent?.(event);
					if (!so.lastEmitted || so.lastEmitted < event.created_at) so.lastEmitted = event.created_at;
					return;
				}
				case "COUNT": {
					const id = data[1];
					const payload = data[2];
					const cr = this.openCountRequests.get(id);
					if (cr) {
						cr.resolve(payload.count);
						this.openCountRequests.delete(id);
					}
					return;
				}
				case "EOSE": {
					const so = this.openSubs.get(data[1]);
					if (!so) return;
					so.receivedEose();
					return;
				}
				case "OK": {
					const id = data[1];
					const ok = data[2];
					const reason = data[3];
					const ep = this.openEventPublishes.get(id);
					if (ep) {
						clearTimeout(ep.timeout);
						if (ok) ep.resolve(reason);
						else ep.reject(new Error(reason));
						this.openEventPublishes.delete(id);
					}
					return;
				}
				case "CLOSED": {
					const id = data[1];
					const so = this.openSubs.get(id);
					if (!so) return;
					so.closed = true;
					so.close(data[2]);
					return;
				}
				case "NOTICE":
					this.onnotice(data[1]);
					return;
				case "AUTH":
					this.challenge = data[1];
					if (this.onauth) this.auth(this.onauth).catch((err) => {
						if (!(err instanceof SendingOnClosedConnection)) throw err;
					});
					return;
				default:
					this.openSubs.get(data[1])?.oncustom?.(data);
					return;
			}
		} catch (err) {
			try {
				const [_, __, event] = JSON.parse(json);
				console.warn(`[nostr] relay ${this.url} error processing message:`, err, event);
			} catch (_) {
				console.warn(`[nostr] relay ${this.url} error processing message:`, err);
			}
			return;
		}
	}
};
var Subscription = class {
	relay;
	id;
	lastEmitted;
	closed = false;
	eosed = false;
	filters;
	alreadyHaveEvent;
	receivedEvent;
	onevent;
	oninvalidevent;
	oneose;
	onclose;
	oncustom;
	eoseTimeout;
	eoseTimeoutHandle;
	constructor(relay, id, filters, params) {
		if (filters.length === 0) throw new Error("subscription can't be created with zero filters");
		this.relay = relay;
		this.filters = filters;
		this.id = id;
		this.alreadyHaveEvent = params.alreadyHaveEvent;
		this.receivedEvent = params.receivedEvent;
		this.eoseTimeout = params.eoseTimeout || relay.baseEoseTimeout;
		this.oneose = params.oneose;
		this.onclose = params.onclose;
		this.oninvalidevent = params.oninvalidevent;
		this.onevent = params.onevent || ((event) => {
			console.warn(`onevent() callback not defined for subscription '${this.id}' in relay ${this.relay.url}. event received:`, event);
		});
	}
	fire() {
		this.relay.send("[\"REQ\",\"" + this.id + "\"," + JSON.stringify(this.filters).substring(1));
		this.eoseTimeoutHandle = setTimeout(this.receivedEose.bind(this), this.eoseTimeout);
	}
	receivedEose() {
		if (this.eosed) return;
		clearTimeout(this.eoseTimeoutHandle);
		this.eosed = true;
		this.oneose?.();
	}
	close(reason = "closed by caller") {
		if (!this.closed && this.relay.connected) {
			try {
				this.relay.send("[\"CLOSE\"," + JSON.stringify(this.id) + "]");
			} catch (err) {
				if (err instanceof SendingOnClosedConnection) {} else throw err;
			}
			this.closed = true;
		}
		this.relay.openSubs.delete(this.id);
		this.relay.ongoingOperations--;
		if (this.relay.ongoingOperations === 0) this.relay.idleSince = Date.now();
		this.onclose?.(reason);
	}
};
var alwaysTrue = (t) => {
	t[verifiedSymbol$1] = true;
	return true;
};
var AbstractSimplePool = class {
	relays = /* @__PURE__ */ new Map();
	seenOn = /* @__PURE__ */ new Map();
	trackRelays = false;
	verifyEvent;
	enablePing;
	enableReconnect;
	automaticallyAuth;
	trustedRelayURLs = /* @__PURE__ */ new Set();
	onRelayConnectionFailure;
	onRelayConnectionSuccess;
	allowConnectingToRelay;
	maxWaitForConnection;
	_WebSocket;
	constructor(opts) {
		this.verifyEvent = opts.verifyEvent;
		this._WebSocket = opts.websocketImplementation;
		this.enablePing = opts.enablePing;
		this.enableReconnect = opts.enableReconnect || false;
		this.automaticallyAuth = opts.automaticallyAuth;
		this.onRelayConnectionFailure = opts.onRelayConnectionFailure;
		this.onRelayConnectionSuccess = opts.onRelayConnectionSuccess;
		this.allowConnectingToRelay = opts.allowConnectingToRelay;
		this.maxWaitForConnection = opts.maxWaitForConnection || 3e3;
	}
	async ensureRelay(url, params) {
		url = normalizeURL$1(url);
		let relay = this.relays.get(url);
		if (!relay) {
			relay = new AbstractRelay(url, {
				verifyEvent: this.trustedRelayURLs.has(url) ? alwaysTrue : this.verifyEvent,
				websocketImplementation: this._WebSocket,
				enablePing: this.enablePing,
				enableReconnect: this.enableReconnect
			});
			relay.onclose = () => {
				this.relays.delete(url);
			};
			this.relays.set(url, relay);
		}
		if (this.automaticallyAuth) {
			const authSignerFn = this.automaticallyAuth(url);
			if (authSignerFn) relay.onauth = authSignerFn;
		}
		try {
			await relay.connect({
				timeout: params?.connectionTimeout,
				abort: params?.abort
			});
		} catch (err) {
			this.relays.delete(url);
			throw err;
		}
		return relay;
	}
	close(relays) {
		relays.map(normalizeURL$1).forEach((url) => {
			this.relays.get(url)?.close();
			this.relays.delete(url);
		});
	}
	subscribe(relays, filter, params) {
		const request = [];
		const uniqUrls = [];
		for (let i2 = 0; i2 < relays.length; i2++) {
			const url = normalizeURL$1(relays[i2]);
			if (!request.find((r) => r.url === url)) {
				if (uniqUrls.indexOf(url) === -1) {
					uniqUrls.push(url);
					request.push({
						url,
						filter
					});
				}
			}
		}
		return this.subscribeMap(request, params);
	}
	subscribeMany(relays, filter, params) {
		return this.subscribe(relays, filter, params);
	}
	subscribeMap(requests, params) {
		const grouped = /* @__PURE__ */ new Map();
		for (const req of requests) {
			const { url, filter } = req;
			if (!grouped.has(url)) grouped.set(url, []);
			grouped.get(url).push(filter);
		}
		const groupedRequests = Array.from(grouped.entries()).map(([url, filters]) => ({
			url,
			filters
		}));
		if (this.trackRelays) params.receivedEvent = (relay, id) => {
			let set = this.seenOn.get(id);
			if (!set) {
				set = /* @__PURE__ */ new Set();
				this.seenOn.set(id, set);
			}
			set.add(relay);
		};
		const _knownIds = /* @__PURE__ */ new Set();
		const subs = [];
		const eosesReceived = [];
		let handleEose = (i2) => {
			if (eosesReceived[i2]) return;
			eosesReceived[i2] = true;
			if (eosesReceived.filter((a) => a).length === groupedRequests.length) {
				params.oneose?.();
				handleEose = () => {};
			}
		};
		const closesReceived = [];
		let handleClose = (i2, reason) => {
			if (closesReceived[i2]) return;
			handleEose(i2);
			closesReceived[i2] = reason;
			if (closesReceived.filter((a) => a).length === groupedRequests.length) {
				params.onclose?.(closesReceived);
				handleClose = () => {};
			}
		};
		const localAlreadyHaveEventHandler = (id) => {
			if (params.alreadyHaveEvent?.(id)) return true;
			const have = _knownIds.has(id);
			_knownIds.add(id);
			return have;
		};
		const allOpened = Promise.all(groupedRequests.map(async ({ url, filters }, i2) => {
			if (this.allowConnectingToRelay?.(url, ["read", filters]) === false) {
				handleClose(i2, "connection skipped by allowConnectingToRelay");
				return;
			}
			let relay;
			try {
				relay = await this.ensureRelay(url, {
					connectionTimeout: this.maxWaitForConnection < (params.maxWait || 0) ? Math.max(params.maxWait * .8, params.maxWait - 1e3) : this.maxWaitForConnection,
					abort: params.abort
				});
			} catch (err) {
				this.onRelayConnectionFailure?.(url);
				handleClose(i2, err?.message || String(err));
				return;
			}
			this.onRelayConnectionSuccess?.(url);
			let subscription = relay.subscribe(filters, {
				...params,
				oneose: () => handleEose(i2),
				onclose: (reason) => {
					if (reason.startsWith("auth-required: ") && params.onauth) relay.auth(params.onauth).then(() => {
						relay.subscribe(filters, {
							...params,
							oneose: () => handleEose(i2),
							onclose: (reason2) => {
								handleClose(i2, reason2);
							},
							alreadyHaveEvent: localAlreadyHaveEventHandler,
							eoseTimeout: params.maxWait,
							abort: params.abort
						});
					}).catch((err) => {
						handleClose(i2, `auth was required and attempted, but failed with: ${err}`);
					});
					else handleClose(i2, reason);
				},
				alreadyHaveEvent: localAlreadyHaveEventHandler,
				eoseTimeout: params.maxWait,
				abort: params.abort
			});
			subs.push(subscription);
		}));
		return { async close(reason) {
			await allOpened;
			subs.forEach((sub) => {
				sub.close(reason);
			});
		} };
	}
	subscribeEose(relays, filter, params) {
		let subcloser;
		subcloser = this.subscribe(relays, filter, {
			...params,
			oneose() {
				const reason = "closed automatically on eose";
				if (subcloser) subcloser.close(reason);
				else params.onclose?.(relays.map((_) => reason));
			}
		});
		return subcloser;
	}
	subscribeManyEose(relays, filter, params) {
		return this.subscribeEose(relays, filter, params);
	}
	async querySync(relays, filter, params) {
		return new Promise(async (resolve) => {
			const events = [];
			this.subscribeEose(relays, filter, {
				...params,
				onevent(event) {
					events.push(event);
				},
				onclose(_) {
					resolve(events);
				}
			});
		});
	}
	async get(relays, filter, params) {
		filter.limit = 1;
		const events = await this.querySync(relays, filter, params);
		events.sort((a, b) => b.created_at - a.created_at);
		return events[0] || null;
	}
	publish(relays, event, params) {
		return relays.map(normalizeURL$1).map(async (url, i2, arr) => {
			if (arr.indexOf(url) !== i2) return Promise.reject("duplicate url");
			if (this.allowConnectingToRelay?.(url, ["write", event]) === false) return Promise.reject("connection skipped by allowConnectingToRelay");
			let r;
			try {
				r = await this.ensureRelay(url, {
					connectionTimeout: this.maxWaitForConnection < (params?.maxWait || 0) ? Math.max(params.maxWait * .8, params.maxWait - 1e3) : this.maxWaitForConnection,
					abort: params?.abort
				});
			} catch (err) {
				this.onRelayConnectionFailure?.(url);
				return String("connection failure: " + String(err));
			}
			return r.publish(event).catch(async (err) => {
				if (err instanceof Error && err.message.startsWith("auth-required: ") && params?.onauth) {
					await r.auth(params.onauth);
					return r.publish(event);
				}
				throw err;
			}).then((reason) => {
				if (this.trackRelays) {
					let set = this.seenOn.get(event.id);
					if (!set) {
						set = /* @__PURE__ */ new Set();
						this.seenOn.set(event.id, set);
					}
					set.add(r);
				}
				return reason;
			});
		});
	}
	listConnectionStatus() {
		const map = /* @__PURE__ */ new Map();
		this.relays.forEach((relay, url) => map.set(url, relay.connected));
		return map;
	}
	destroy() {
		this.relays.forEach((conn) => conn.close());
		this.relays = /* @__PURE__ */ new Map();
	}
	pruneIdleRelays(idleThresholdMs = 1e4) {
		const prunedUrls = [];
		for (const [url, relay] of this.relays) if (relay.idleSince && Date.now() - relay.idleSince >= idleThresholdMs) {
			this.relays.delete(url);
			prunedUrls.push(url);
			relay.close();
		}
		return prunedUrls;
	}
};
var _WebSocket$1;
try {
	_WebSocket$1 = WebSocket;
} catch {}
var SimplePool = class extends AbstractSimplePool {
	constructor(options) {
		super({
			verifyEvent: verifyEvent$1,
			websocketImplementation: _WebSocket$1,
			maxWaitForConnection: 3e3,
			...options
		});
	}
};
//#endregion
//#region node_modules/@noble/ciphers/aes.js
const BLOCK_SIZE = 16;
const POLY = 283;
function validateKeyLength(key) {
	if (![
		16,
		24,
		32
	].includes(key.length)) throw new Error("\"aes key\" expected Uint8Array of length 16/24/32, got length=" + key.length);
}
function mul2(n) {
	return n << 1 ^ POLY & -(n >> 7);
}
function mul(a, b) {
	let res = 0;
	for (; b > 0; b >>= 1) {
		res ^= a & -(b & 1);
		a = mul2(a);
	}
	return res;
}
const sbox = /* @__PURE__ */ (() => {
	const t = new Uint8Array(256);
	for (let i = 0, x = 1; i < 256; i++, x ^= mul2(x)) t[i] = x;
	const box = new Uint8Array(256);
	box[0] = 99;
	for (let i = 0; i < 255; i++) {
		let x = t[255 - i];
		x |= x << 8;
		box[t[i]] = (x ^ x >> 4 ^ x >> 5 ^ x >> 6 ^ x >> 7 ^ 99) & 255;
	}
	clean(t);
	return box;
})();
const invSbox = /* @__PURE__ */ sbox.map((_, j) => sbox.indexOf(j));
const rotr32_8 = (n) => n << 24 | n >>> 8;
const rotl32_8 = (n) => n << 8 | n >>> 24;
function genTtable(sbox, fn) {
	if (sbox.length !== 256) throw new Error("Wrong sbox length");
	const T0 = new Uint32Array(256).map((_, j) => fn(sbox[j]));
	const T1 = T0.map(rotl32_8);
	const T2 = T1.map(rotl32_8);
	const T3 = T2.map(rotl32_8);
	const T01 = new Uint32Array(256 * 256);
	const T23 = new Uint32Array(256 * 256);
	const sbox2 = new Uint16Array(256 * 256);
	for (let i = 0; i < 256; i++) for (let j = 0; j < 256; j++) {
		const idx = i * 256 + j;
		T01[idx] = T0[i] ^ T1[j];
		T23[idx] = T2[i] ^ T3[j];
		sbox2[idx] = sbox[i] << 8 | sbox[j];
	}
	return {
		sbox,
		sbox2,
		T0,
		T1,
		T2,
		T3,
		T01,
		T23
	};
}
const tableEncoding = /* @__PURE__ */ genTtable(sbox, (s) => mul(s, 3) << 24 | s << 16 | s << 8 | mul(s, 2));
const tableDecoding = /* @__PURE__ */ genTtable(invSbox, (s) => mul(s, 11) << 24 | mul(s, 13) << 16 | mul(s, 9) << 8 | mul(s, 14));
const xPowers = /* @__PURE__ */ (() => {
	const p = new Uint8Array(16);
	for (let i = 0, x = 1; i < 16; i++, x = mul2(x)) p[i] = x;
	return p;
})();
/** Key expansion used in CTR. */
function expandKeyLE(key) {
	abytes(key);
	const len = key.length;
	validateKeyLength(key);
	const { sbox2 } = tableEncoding;
	const toClean = [];
	if (!isAligned32$1(key)) toClean.push(key = copyBytes(key));
	const k32 = u32(key);
	const Nk = k32.length;
	const subByte = (n) => applySbox(sbox2, n, n, n, n);
	const xk = new Uint32Array(len + 28);
	xk.set(k32);
	for (let i = Nk; i < xk.length; i++) {
		let t = xk[i - 1];
		if (i % Nk === 0) t = subByte(rotr32_8(t)) ^ xPowers[i / Nk - 1];
		else if (Nk > 6 && i % Nk === 4) t = subByte(t);
		xk[i] = xk[i - Nk] ^ t;
	}
	clean(...toClean);
	return xk;
}
function expandKeyDecLE(key) {
	const encKey = expandKeyLE(key);
	const xk = encKey.slice();
	const Nk = encKey.length;
	const { sbox2 } = tableEncoding;
	const { T0, T1, T2, T3 } = tableDecoding;
	for (let i = 0; i < Nk; i += 4) for (let j = 0; j < 4; j++) xk[i + j] = encKey[Nk - i - 4 + j];
	clean(encKey);
	for (let i = 4; i < Nk - 4; i++) {
		const x = xk[i];
		const w = applySbox(sbox2, x, x, x, x);
		xk[i] = T0[w & 255] ^ T1[w >>> 8 & 255] ^ T2[w >>> 16 & 255] ^ T3[w >>> 24];
	}
	return xk;
}
function apply0123(T01, T23, s0, s1, s2, s3) {
	return T01[s0 << 8 & 65280 | s1 >>> 8 & 255] ^ T23[s2 >>> 8 & 65280 | s3 >>> 24 & 255];
}
function applySbox(sbox2, s0, s1, s2, s3) {
	return sbox2[s0 & 255 | s1 & 65280] | sbox2[s2 >>> 16 & 255 | s3 >>> 16 & 65280] << 16;
}
function encrypt$1(xk, s0, s1, s2, s3) {
	const { sbox2, T01, T23 } = tableEncoding;
	let k = 0;
	s0 ^= xk[k++], s1 ^= xk[k++], s2 ^= xk[k++], s3 ^= xk[k++];
	const rounds = xk.length / 4 - 2;
	for (let i = 0; i < rounds; i++) {
		const t0 = xk[k++] ^ apply0123(T01, T23, s0, s1, s2, s3);
		const t1 = xk[k++] ^ apply0123(T01, T23, s1, s2, s3, s0);
		const t2 = xk[k++] ^ apply0123(T01, T23, s2, s3, s0, s1);
		const t3 = xk[k++] ^ apply0123(T01, T23, s3, s0, s1, s2);
		s0 = t0, s1 = t1, s2 = t2, s3 = t3;
	}
	return {
		s0: xk[k++] ^ applySbox(sbox2, s0, s1, s2, s3),
		s1: xk[k++] ^ applySbox(sbox2, s1, s2, s3, s0),
		s2: xk[k++] ^ applySbox(sbox2, s2, s3, s0, s1),
		s3: xk[k++] ^ applySbox(sbox2, s3, s0, s1, s2)
	};
}
function decrypt$1(xk, s0, s1, s2, s3) {
	const { sbox2, T01, T23 } = tableDecoding;
	let k = 0;
	s0 ^= xk[k++], s1 ^= xk[k++], s2 ^= xk[k++], s3 ^= xk[k++];
	const rounds = xk.length / 4 - 2;
	for (let i = 0; i < rounds; i++) {
		const t0 = xk[k++] ^ apply0123(T01, T23, s0, s3, s2, s1);
		const t1 = xk[k++] ^ apply0123(T01, T23, s1, s0, s3, s2);
		const t2 = xk[k++] ^ apply0123(T01, T23, s2, s1, s0, s3);
		const t3 = xk[k++] ^ apply0123(T01, T23, s3, s2, s1, s0);
		s0 = t0, s1 = t1, s2 = t2, s3 = t3;
	}
	return {
		s0: xk[k++] ^ applySbox(sbox2, s0, s3, s2, s1),
		s1: xk[k++] ^ applySbox(sbox2, s1, s0, s3, s2),
		s2: xk[k++] ^ applySbox(sbox2, s2, s1, s0, s3),
		s3: xk[k++] ^ applySbox(sbox2, s3, s2, s1, s0)
	};
}
function validateBlockDecrypt(data) {
	abytes(data);
	if (data.length % BLOCK_SIZE !== 0) throw new Error("aes-(cbc/ecb).decrypt ciphertext should consist of blocks with size 16");
}
function validateBlockEncrypt(plaintext, pcks5, dst) {
	abytes(plaintext);
	let outLen = plaintext.length;
	const remaining = outLen % BLOCK_SIZE;
	if (!pcks5 && remaining !== 0) throw new Error("aec/(cbc-ecb): unpadded plaintext with disabled padding");
	if (!isAligned32$1(plaintext)) plaintext = copyBytes(plaintext);
	const b = u32(plaintext);
	if (pcks5) {
		let left = BLOCK_SIZE - remaining;
		if (!left) left = BLOCK_SIZE;
		outLen = outLen + left;
	}
	dst = getOutput(outLen, dst);
	complexOverlapBytes(plaintext, dst);
	return {
		b,
		o: u32(dst),
		out: dst
	};
}
function validatePCKS(data, pcks5) {
	if (!pcks5) return data;
	const len = data.length;
	if (!len) throw new Error("aes/pcks5: empty ciphertext not allowed");
	const lastByte = data[len - 1];
	if (lastByte <= 0 || lastByte > 16) throw new Error("aes/pcks5: wrong padding");
	const out = data.subarray(0, -lastByte);
	for (let i = 0; i < lastByte; i++) if (data[len - i - 1] !== lastByte) throw new Error("aes/pcks5: wrong padding");
	return out;
}
function padPCKS(left) {
	const tmp = new Uint8Array(16);
	const tmp32 = u32(tmp);
	tmp.set(left);
	const paddingByte = BLOCK_SIZE - left.length;
	for (let i = BLOCK_SIZE - paddingByte; i < BLOCK_SIZE; i++) tmp[i] = paddingByte;
	return tmp32;
}
/**
* **CBC** (Cipher Block Chaining): Each plaintext block is XORed with the
* previous block of ciphertext before encryption.
* Hard to use: requires proper padding and an IV. Unauthenticated: needs MAC.
*/
const cbc = /* @__PURE__ */ wrapCipher({
	blockSize: 16,
	nonceLength: 16
}, function aescbc(key, iv, opts = {}) {
	const pcks5 = !opts.disablePadding;
	return {
		encrypt(plaintext, dst) {
			const xk = expandKeyLE(key);
			const { b, o, out: _out } = validateBlockEncrypt(plaintext, pcks5, dst);
			let _iv = iv;
			const toClean = [xk];
			if (!isAligned32$1(_iv)) toClean.push(_iv = copyBytes(_iv));
			const n32 = u32(_iv);
			let s0 = n32[0], s1 = n32[1], s2 = n32[2], s3 = n32[3];
			let i = 0;
			for (; i + 4 <= b.length;) {
				s0 ^= b[i + 0], s1 ^= b[i + 1], s2 ^= b[i + 2], s3 ^= b[i + 3];
				({s0, s1, s2, s3} = encrypt$1(xk, s0, s1, s2, s3));
				o[i++] = s0, o[i++] = s1, o[i++] = s2, o[i++] = s3;
			}
			if (pcks5) {
				const tmp32 = padPCKS(plaintext.subarray(i * 4));
				s0 ^= tmp32[0], s1 ^= tmp32[1], s2 ^= tmp32[2], s3 ^= tmp32[3];
				({s0, s1, s2, s3} = encrypt$1(xk, s0, s1, s2, s3));
				o[i++] = s0, o[i++] = s1, o[i++] = s2, o[i++] = s3;
			}
			clean(...toClean);
			return _out;
		},
		decrypt(ciphertext, dst) {
			validateBlockDecrypt(ciphertext);
			const xk = expandKeyDecLE(key);
			let _iv = iv;
			const toClean = [xk];
			if (!isAligned32$1(_iv)) toClean.push(_iv = copyBytes(_iv));
			const n32 = u32(_iv);
			dst = getOutput(ciphertext.length, dst);
			if (!isAligned32$1(ciphertext)) toClean.push(ciphertext = copyBytes(ciphertext));
			complexOverlapBytes(ciphertext, dst);
			const b = u32(ciphertext);
			const o = u32(dst);
			let s0 = n32[0], s1 = n32[1], s2 = n32[2], s3 = n32[3];
			for (let i = 0; i + 4 <= b.length;) {
				const ps0 = s0, ps1 = s1, ps2 = s2, ps3 = s3;
				s0 = b[i + 0], s1 = b[i + 1], s2 = b[i + 2], s3 = b[i + 3];
				const { s0: o0, s1: o1, s2: o2, s3: o3 } = decrypt$1(xk, s0, s1, s2, s3);
				o[i++] = o0 ^ ps0, o[i++] = o1 ^ ps1, o[i++] = o2 ^ ps2, o[i++] = o3 ^ ps3;
			}
			clean(...toClean);
			return validatePCKS(dst, pcks5);
		}
	};
});
function isBytes32(a) {
	return a instanceof Uint32Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint32Array";
}
function encryptBlock(xk, block) {
	abytes(block, 16, "block");
	if (!isBytes32(xk)) throw new Error("_encryptBlock accepts result of expandKeyLE");
	const b32 = u32(block);
	let { s0, s1, s2, s3 } = encrypt$1(xk, b32[0], b32[1], b32[2], b32[3]);
	b32[0] = s0, b32[1] = s1, b32[2] = s2, b32[3] = s3;
	return block;
}
/**
* Left-shift by one bit and conditionally XOR with 0x87:
* ```
* if MSB(L) is equal to 0
* then    K1 := L << 1;
* else    K1 := (L << 1) XOR const_Rb;
* ```
*
* Specs: [RFC 4493, Section 2.3](https://www.rfc-editor.org/rfc/rfc4493.html#section-2.3),
*        [RFC 5297 Section 2.3](https://datatracker.ietf.org/doc/html/rfc5297.html#section-2.3)
*
* @returns modified `block` (for chaining)
*/
function dbl(block) {
	let carry = 0;
	for (let i = BLOCK_SIZE - 1; i >= 0; i--) {
		const newCarry = (block[i] & 128) >>> 7;
		block[i] = block[i] << 1 | carry;
		carry = newCarry;
	}
	if (carry) block[BLOCK_SIZE - 1] ^= 135;
	return block;
}
/**
* `a XOR b`, running in-site on `a`.
* @param a left operand and output
* @param b right operand
* @returns `a` (for chaining)
*/
function xorBlock(a, b) {
	if (a.length !== b.length) throw new Error("xorBlock: blocks must have same length");
	for (let i = 0; i < a.length; i++) a[i] = a[i] ^ b[i];
	return a;
}
/**
* Internal CMAC class.
*/
var _CMAC = class {
	buffer;
	destroyed;
	k1;
	k2;
	xk;
	constructor(key) {
		abytes(key);
		validateKeyLength(key);
		this.xk = expandKeyLE(key);
		this.buffer = new Uint8Array(0);
		this.destroyed = false;
		const L = new Uint8Array(BLOCK_SIZE);
		encryptBlock(this.xk, L);
		this.k1 = dbl(L);
		this.k2 = dbl(new Uint8Array(this.k1));
	}
	update(data) {
		const { destroyed, buffer } = this;
		if (destroyed) throw new Error("CMAC instance was destroyed");
		abytes(data);
		const newBuffer = new Uint8Array(buffer.length + data.length);
		newBuffer.set(buffer);
		newBuffer.set(data, buffer.length);
		this.buffer = newBuffer;
		return this;
	}
	digest() {
		if (this.destroyed) throw new Error("CMAC instance was destroyed");
		const { buffer } = this;
		const msgLen = buffer.length;
		let n = Math.ceil(msgLen / BLOCK_SIZE);
		let flag;
		if (n === 0) {
			n = 1;
			flag = false;
		} else flag = msgLen % BLOCK_SIZE === 0;
		const lastBlockStart = (n - 1) * BLOCK_SIZE;
		const lastBlockData = buffer.subarray(lastBlockStart);
		let m_last;
		if (flag) m_last = xorBlock(new Uint8Array(lastBlockData), this.k1);
		else {
			const padded = new Uint8Array(BLOCK_SIZE);
			padded.set(lastBlockData);
			padded[lastBlockData.length] = 128;
			m_last = xorBlock(padded, this.k2);
		}
		let x = new Uint8Array(BLOCK_SIZE);
		for (let i = 0; i < n - 1; i++) {
			xorBlock(x, buffer.subarray(i * BLOCK_SIZE, (i + 1) * BLOCK_SIZE));
			encryptBlock(this.xk, x);
		}
		xorBlock(x, m_last);
		encryptBlock(this.xk, x);
		clean(m_last);
		return x;
	}
	destroy() {
		const { buffer, destroyed, xk, k1, k2 } = this;
		if (destroyed) return;
		this.destroyed = true;
		clean(buffer, xk, k1, k2);
	}
};
/**
* AES-CMAC (Cipher-based Message Authentication Code).
* Specs: [RFC 4493](https://www.rfc-editor.org/rfc/rfc4493.html).
*/
const cmac = (key, message) => new _CMAC(key).update(message).digest();
cmac.create = (key) => new _CMAC(key);
//#endregion
//#region node_modules/nostr-tools/lib/esm/index.js
init_secp256k1();
init_utils$1();
init_sha2();
init_hmac();
var __defProp = Object.defineProperty;
var __export = (target, all) => {
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
};
var verifiedSymbol = Symbol("verified");
var isRecord = (obj) => obj instanceof Object;
function validateEvent(event) {
	if (!isRecord(event)) return false;
	if (typeof event.kind !== "number") return false;
	if (typeof event.content !== "string") return false;
	if (typeof event.created_at !== "number") return false;
	if (typeof event.pubkey !== "string") return false;
	if (!event.pubkey.match(/^[a-f0-9]{64}$/)) return false;
	if (!Array.isArray(event.tags)) return false;
	for (let i2 = 0; i2 < event.tags.length; i2++) {
		let tag = event.tags[i2];
		if (!Array.isArray(tag)) return false;
		for (let j = 0; j < tag.length; j++) if (typeof tag[j] !== "string") return false;
	}
	return true;
}
__export({}, {
	binarySearch: () => binarySearch,
	bytesToHex: () => bytesToHex$2,
	hexToBytes: () => hexToBytes$2,
	insertEventIntoAscendingList: () => insertEventIntoAscendingList,
	insertEventIntoDescendingList: () => insertEventIntoDescendingList,
	mergeReverseSortedLists: () => mergeReverseSortedLists,
	normalizeURL: () => normalizeURL,
	utf8Decoder: () => utf8Decoder,
	utf8Encoder: () => utf8Encoder
});
var utf8Decoder = new TextDecoder("utf-8");
var utf8Encoder = new TextEncoder();
function normalizeURL(url) {
	try {
		if (url.indexOf("://") === -1) url = "wss://" + url;
		let p = new URL(url);
		if (p.protocol === "http:") p.protocol = "ws:";
		else if (p.protocol === "https:") p.protocol = "wss:";
		p.pathname = p.pathname.replace(/\/+/g, "/");
		if (p.pathname.endsWith("/")) p.pathname = p.pathname.slice(0, -1);
		if (p.port === "80" && p.protocol === "ws:" || p.port === "443" && p.protocol === "wss:") p.port = "";
		p.searchParams.sort();
		p.hash = "";
		return p.toString();
	} catch (e) {
		throw new Error(`Invalid URL: ${url}`);
	}
}
function insertEventIntoDescendingList(sortedArray, event) {
	const [idx, found] = binarySearch(sortedArray, (b) => {
		if (event.id === b.id) return 0;
		if (event.created_at === b.created_at) return -1;
		return b.created_at - event.created_at;
	});
	if (!found) sortedArray.splice(idx, 0, event);
	return sortedArray;
}
function insertEventIntoAscendingList(sortedArray, event) {
	const [idx, found] = binarySearch(sortedArray, (b) => {
		if (event.id === b.id) return 0;
		if (event.created_at === b.created_at) return -1;
		return event.created_at - b.created_at;
	});
	if (!found) sortedArray.splice(idx, 0, event);
	return sortedArray;
}
function binarySearch(arr, compare) {
	let start = 0;
	let end = arr.length - 1;
	while (start <= end) {
		const mid = Math.floor((start + end) / 2);
		const cmp = compare(arr[mid]);
		if (cmp === 0) return [mid, true];
		if (cmp < 0) end = mid - 1;
		else start = mid + 1;
	}
	return [start, false];
}
function mergeReverseSortedLists(list1, list2) {
	const result = new Array(list1.length + list2.length);
	result.length = 0;
	let i1 = 0;
	let i2 = 0;
	let sameTimestampIds = [];
	while (i1 < list1.length && i2 < list2.length) {
		let next;
		if (list1[i1]?.created_at > list2[i2]?.created_at) {
			next = list1[i1];
			i1++;
		} else {
			next = list2[i2];
			i2++;
		}
		if (result.length > 0 && result[result.length - 1].created_at === next.created_at) {
			if (sameTimestampIds.includes(next.id)) continue;
		} else sameTimestampIds.length = 0;
		result.push(next);
		sameTimestampIds.push(next.id);
	}
	while (i1 < list1.length) {
		const next = list1[i1];
		i1++;
		if (result.length > 0 && result[result.length - 1].created_at === next.created_at) {
			if (sameTimestampIds.includes(next.id)) continue;
		} else sameTimestampIds.length = 0;
		result.push(next);
		sameTimestampIds.push(next.id);
	}
	while (i2 < list2.length) {
		const next = list2[i2];
		i2++;
		if (result.length > 0 && result[result.length - 1].created_at === next.created_at) {
			if (sameTimestampIds.includes(next.id)) continue;
		} else sameTimestampIds.length = 0;
		result.push(next);
		sameTimestampIds.push(next.id);
	}
	return result;
}
var JS = class {
	generateSecretKey() {
		return schnorr$1.utils.randomSecretKey();
	}
	getPublicKey(secretKey) {
		return bytesToHex$2(schnorr$1.getPublicKey(secretKey));
	}
	finalizeEvent(t, secretKey) {
		const event = t;
		event.pubkey = bytesToHex$2(schnorr$1.getPublicKey(secretKey));
		event.id = getEventHash(event);
		event.sig = bytesToHex$2(schnorr$1.sign(hexToBytes$2(getEventHash(event)), secretKey));
		event[verifiedSymbol] = true;
		return event;
	}
	verifyEvent(event) {
		if (typeof event[verifiedSymbol] === "boolean") return event[verifiedSymbol];
		try {
			const hash = getEventHash(event);
			if (hash !== event.id) {
				event[verifiedSymbol] = false;
				return false;
			}
			const valid = schnorr$1.verify(hexToBytes$2(event.sig), hexToBytes$2(hash), hexToBytes$2(event.pubkey));
			event[verifiedSymbol] = valid;
			return valid;
		} catch (err) {
			event[verifiedSymbol] = false;
			return false;
		}
	}
};
function serializeEvent(evt) {
	if (!validateEvent(evt)) throw new Error("can't serialize event with wrong or missing properties");
	return JSON.stringify([
		0,
		evt.pubkey,
		evt.created_at,
		evt.kind,
		evt.tags,
		evt.content
	]);
}
function getEventHash(event) {
	return bytesToHex$2(sha256$1(utf8Encoder.encode(serializeEvent(event))));
}
var i = new JS();
var generateSecretKey = i.generateSecretKey;
var getPublicKey = i.getPublicKey;
var finalizeEvent = i.finalizeEvent;
var verifyEvent = i.verifyEvent;
__export({}, {
	Application: () => Application,
	BadgeAward: () => BadgeAward,
	BadgeDefinition: () => BadgeDefinition,
	BlockedRelaysList: () => BlockedRelaysList,
	BlossomServerList: () => BlossomServerList,
	BookmarkList: () => BookmarkList,
	Bookmarksets: () => Bookmarksets,
	Calendar: () => Calendar,
	CalendarEventRSVP: () => CalendarEventRSVP,
	ChannelCreation: () => ChannelCreation,
	ChannelHideMessage: () => ChannelHideMessage,
	ChannelMessage: () => ChannelMessage,
	ChannelMetadata: () => ChannelMetadata,
	ChannelMuteUser: () => ChannelMuteUser,
	ChatMessage: () => ChatMessage,
	ClassifiedListing: () => ClassifiedListing,
	ClientAuth: () => ClientAuth,
	Comment: () => Comment,
	CommunitiesList: () => CommunitiesList,
	CommunityDefinition: () => CommunityDefinition,
	CommunityPostApproval: () => CommunityPostApproval,
	Contacts: () => Contacts,
	CreateOrUpdateProduct: () => CreateOrUpdateProduct,
	CreateOrUpdateStall: () => CreateOrUpdateStall,
	Curationsets: () => Curationsets,
	Date: () => Date2,
	DirectMessageRelaysList: () => DirectMessageRelaysList,
	DraftClassifiedListing: () => DraftClassifiedListing,
	DraftLong: () => DraftLong,
	Emojisets: () => Emojisets,
	EncryptedDirectMessage: () => EncryptedDirectMessage,
	EventDeletion: () => EventDeletion,
	FavoriteRelays: () => FavoriteRelays,
	FileMessage: () => FileMessage,
	FileMetadata: () => FileMetadata,
	FileServerPreference: () => FileServerPreference,
	Followsets: () => Followsets,
	ForumThread: () => ForumThread,
	GenericRepost: () => GenericRepost,
	Genericlists: () => Genericlists,
	GiftWrap: () => GiftWrap,
	GroupMetadata: () => GroupMetadata,
	HTTPAuth: () => HTTPAuth,
	Handlerinformation: () => Handlerinformation,
	Handlerrecommendation: () => Handlerrecommendation,
	Highlights: () => Highlights,
	InterestsList: () => InterestsList,
	Interestsets: () => Interestsets,
	JobFeedback: () => JobFeedback,
	JobRequest: () => JobRequest,
	JobResult: () => JobResult,
	Label: () => Label,
	LightningPubRPC: () => LightningPubRPC,
	LiveChatMessage: () => LiveChatMessage,
	LiveEvent: () => LiveEvent,
	LongFormArticle: () => LongFormArticle,
	Metadata: () => Metadata,
	Mutelist: () => Mutelist,
	NWCWalletInfo: () => NWCWalletInfo,
	NWCWalletRequest: () => NWCWalletRequest,
	NWCWalletResponse: () => NWCWalletResponse,
	NormalVideo: () => NormalVideo,
	NostrConnect: () => NostrConnect,
	OpenTimestamps: () => OpenTimestamps,
	Photo: () => Photo,
	Pinlist: () => Pinlist,
	Poll: () => Poll,
	PollResponse: () => PollResponse,
	PrivateDirectMessage: () => PrivateDirectMessage,
	ProblemTracker: () => ProblemTracker,
	ProfileBadges: () => ProfileBadges,
	PublicChatsList: () => PublicChatsList,
	Reaction: () => Reaction,
	RecommendRelay: () => RecommendRelay,
	RelayList: () => RelayList,
	RelayReview: () => RelayReview,
	Relaysets: () => Relaysets,
	Report: () => Report,
	Reporting: () => Reporting,
	Repost: () => Repost,
	Seal: () => Seal,
	SearchRelaysList: () => SearchRelaysList,
	ShortTextNote: () => ShortTextNote,
	ShortVideo: () => ShortVideo,
	Time: () => Time,
	UserEmojiList: () => UserEmojiList,
	UserStatuses: () => UserStatuses,
	Voice: () => Voice,
	VoiceComment: () => VoiceComment,
	Zap: () => Zap,
	ZapGoal: () => ZapGoal,
	ZapRequest: () => ZapRequest,
	classifyKind: () => classifyKind,
	isAddressableKind: () => isAddressableKind,
	isEphemeralKind: () => isEphemeralKind,
	isKind: () => isKind,
	isRegularKind: () => isRegularKind,
	isReplaceableKind: () => isReplaceableKind
});
function isRegularKind(kind) {
	return kind < 1e4 && kind !== 0 && kind !== 3;
}
function isReplaceableKind(kind) {
	return kind === 0 || kind === 3 || 1e4 <= kind && kind < 2e4;
}
function isEphemeralKind(kind) {
	return 2e4 <= kind && kind < 3e4;
}
function isAddressableKind(kind) {
	return 3e4 <= kind && kind < 4e4;
}
function classifyKind(kind) {
	if (isRegularKind(kind)) return "regular";
	if (isReplaceableKind(kind)) return "replaceable";
	if (isEphemeralKind(kind)) return "ephemeral";
	if (isAddressableKind(kind)) return "parameterized";
	return "unknown";
}
function isKind(event, kind) {
	const kindAsArray = kind instanceof Array ? kind : [kind];
	return validateEvent(event) && kindAsArray.includes(event.kind) || false;
}
var Metadata = 0;
var ShortTextNote = 1;
var RecommendRelay = 2;
var Contacts = 3;
var EncryptedDirectMessage = 4;
var EventDeletion = 5;
var Repost = 6;
var Reaction = 7;
var BadgeAward = 8;
var ChatMessage = 9;
var ForumThread = 11;
var Seal = 13;
var PrivateDirectMessage = 14;
var FileMessage = 15;
var GenericRepost = 16;
var Photo = 20;
var NormalVideo = 21;
var ShortVideo = 22;
var ChannelCreation = 40;
var ChannelMetadata = 41;
var ChannelMessage = 42;
var ChannelHideMessage = 43;
var ChannelMuteUser = 44;
var OpenTimestamps = 1040;
var GiftWrap = 1059;
var Poll = 1068;
var FileMetadata = 1063;
var Comment = 1111;
var LiveChatMessage = 1311;
var Voice = 1222;
var VoiceComment = 1244;
var ProblemTracker = 1971;
var Report = 1984;
var Reporting = 1984;
var Label = 1985;
var CommunityPostApproval = 4550;
var JobRequest = 5999;
var JobResult = 6999;
var JobFeedback = 7e3;
var ZapGoal = 9041;
var ZapRequest = 9734;
var Zap = 9735;
var Highlights = 9802;
var PollResponse = 1018;
var Mutelist = 1e4;
var Pinlist = 10001;
var RelayList = 10002;
var BookmarkList = 10003;
var CommunitiesList = 10004;
var PublicChatsList = 10005;
var BlockedRelaysList = 10006;
var SearchRelaysList = 10007;
var FavoriteRelays = 10012;
var InterestsList = 10015;
var UserEmojiList = 10030;
var DirectMessageRelaysList = 10050;
var FileServerPreference = 10096;
var BlossomServerList = 10063;
var NWCWalletInfo = 13194;
var LightningPubRPC = 21e3;
var ClientAuth = 22242;
var NWCWalletRequest = 23194;
var NWCWalletResponse = 23195;
var NostrConnect = 24133;
var HTTPAuth = 27235;
var Followsets = 3e4;
var Genericlists = 30001;
var Relaysets = 30002;
var Bookmarksets = 30003;
var Curationsets = 30004;
var ProfileBadges = 30008;
var BadgeDefinition = 30009;
var Interestsets = 30015;
var CreateOrUpdateStall = 30017;
var CreateOrUpdateProduct = 30018;
var LongFormArticle = 30023;
var DraftLong = 30024;
var Emojisets = 30030;
var Application = 30078;
var LiveEvent = 30311;
var UserStatuses = 30315;
var ClassifiedListing = 30402;
var DraftClassifiedListing = 30403;
var Date2 = 31922;
var Time = 31923;
var Calendar = 31924;
var CalendarEventRSVP = 31925;
var RelayReview = 31987;
var Handlerrecommendation = 31989;
var Handlerinformation = 31990;
var CommunityDefinition = 34550;
var GroupMetadata = 39e3;
__export({}, {
	getHex64: () => getHex64,
	getInt: () => getInt,
	getSubscriptionId: () => getSubscriptionId,
	matchEventId: () => matchEventId,
	matchEventKind: () => matchEventKind,
	matchEventPubkey: () => matchEventPubkey
});
function getHex64(json, field) {
	let len = field.length + 3;
	let idx = json.indexOf(`"${field}":`) + len;
	let s = json.slice(idx).indexOf(`"`) + idx + 1;
	return json.slice(s, s + 64);
}
function getInt(json, field) {
	let len = field.length;
	let idx = json.indexOf(`"${field}":`) + len + 3;
	let sliced = json.slice(idx);
	let end = Math.min(sliced.indexOf(","), sliced.indexOf("}"));
	return parseInt(sliced.slice(0, end), 10);
}
function getSubscriptionId(json) {
	let idx = json.slice(0, 22).indexOf(`"EVENT"`);
	if (idx === -1) return null;
	let pstart = json.slice(idx + 7 + 1).indexOf(`"`);
	if (pstart === -1) return null;
	let start = idx + 7 + 1 + pstart;
	let pend = json.slice(start + 1, 80).indexOf(`"`);
	if (pend === -1) return null;
	let end = start + 1 + pend;
	return json.slice(start + 1, end);
}
function matchEventId(json, id) {
	return id === getHex64(json, "id");
}
function matchEventPubkey(json, pubkey) {
	return pubkey === getHex64(json, "pubkey");
}
function matchEventKind(json, kind) {
	return kind === getInt(json, "kind");
}
__export({}, { makeAuthEvent: () => makeAuthEvent });
function makeAuthEvent(relayURL, challenge) {
	return {
		kind: ClientAuth,
		created_at: Math.floor(Date.now() / 1e3),
		tags: [["relay", relayURL], ["challenge", challenge]],
		content: ""
	};
}
var nip19_exports = {};
__export(nip19_exports, {
	BECH32_REGEX: () => BECH32_REGEX,
	Bech32MaxSize: () => Bech32MaxSize,
	NostrTypeGuard: () => NostrTypeGuard,
	decode: () => decode$1,
	decodeNostrURI: () => decodeNostrURI,
	encodeBytes: () => encodeBytes,
	naddrEncode: () => naddrEncode,
	neventEncode: () => neventEncode,
	noteEncode: () => noteEncode,
	nprofileEncode: () => nprofileEncode,
	npubEncode: () => npubEncode,
	nsecEncode: () => nsecEncode
});
var NostrTypeGuard = {
	isNProfile: (value) => /^nprofile1[a-z\d]+$/.test(value || ""),
	isNEvent: (value) => /^nevent1[a-z\d]+$/.test(value || ""),
	isNAddr: (value) => /^naddr1[a-z\d]+$/.test(value || ""),
	isNSec: (value) => /^nsec1[a-z\d]{58}$/.test(value || ""),
	isNPub: (value) => /^npub1[a-z\d]{58}$/.test(value || ""),
	isNote: (value) => /^note1[a-z\d]+$/.test(value || ""),
	isNcryptsec: (value) => /^ncryptsec1[a-z\d]+$/.test(value || "")
};
var Bech32MaxSize = 5e3;
var BECH32_REGEX = /[\x21-\x7E]{1,83}1[023456789acdefghjklmnpqrstuvwxyz]{6,}/;
function integerToUint8Array(number) {
	const uint8Array = new Uint8Array(4);
	uint8Array[0] = number >> 24 & 255;
	uint8Array[1] = number >> 16 & 255;
	uint8Array[2] = number >> 8 & 255;
	uint8Array[3] = number & 255;
	return uint8Array;
}
function decodeNostrURI(nip19code) {
	try {
		if (nip19code.startsWith("nostr:")) nip19code = nip19code.substring(6);
		return decode$1(nip19code);
	} catch (_err) {
		return {
			type: "invalid",
			data: null
		};
	}
}
function decode$1(code) {
	let { prefix, words } = bech32.decode(code, Bech32MaxSize);
	let data = new Uint8Array(bech32.fromWords(words));
	switch (prefix) {
		case "nprofile": {
			let tlv = parseTLV(data);
			if (!tlv[0]?.[0]) throw new Error("missing TLV 0 for nprofile");
			if (tlv[0][0].length !== 32) throw new Error("TLV 0 should be 32 bytes");
			return {
				type: "nprofile",
				data: {
					pubkey: bytesToHex$2(tlv[0][0]),
					relays: tlv[1] ? tlv[1].map((d) => utf8Decoder.decode(d)) : []
				}
			};
		}
		case "nevent": {
			let tlv = parseTLV(data);
			if (!tlv[0]?.[0]) throw new Error("missing TLV 0 for nevent");
			if (tlv[0][0].length !== 32) throw new Error("TLV 0 should be 32 bytes");
			if (tlv[2] && tlv[2][0].length !== 32) throw new Error("TLV 2 should be 32 bytes");
			if (tlv[3] && tlv[3][0].length !== 4) throw new Error("TLV 3 should be 4 bytes");
			return {
				type: "nevent",
				data: {
					id: bytesToHex$2(tlv[0][0]),
					relays: tlv[1] ? tlv[1].map((d) => utf8Decoder.decode(d)) : [],
					author: tlv[2]?.[0] ? bytesToHex$2(tlv[2][0]) : void 0,
					kind: tlv[3]?.[0] ? parseInt(bytesToHex$2(tlv[3][0]), 16) : void 0
				}
			};
		}
		case "naddr": {
			let tlv = parseTLV(data);
			if (!tlv[0]?.[0]) throw new Error("missing TLV 0 for naddr");
			if (!tlv[2]?.[0]) throw new Error("missing TLV 2 for naddr");
			if (tlv[2][0].length !== 32) throw new Error("TLV 2 should be 32 bytes");
			if (!tlv[3]?.[0]) throw new Error("missing TLV 3 for naddr");
			if (tlv[3][0].length !== 4) throw new Error("TLV 3 should be 4 bytes");
			return {
				type: "naddr",
				data: {
					identifier: utf8Decoder.decode(tlv[0][0]),
					pubkey: bytesToHex$2(tlv[2][0]),
					kind: parseInt(bytesToHex$2(tlv[3][0]), 16),
					relays: tlv[1] ? tlv[1].map((d) => utf8Decoder.decode(d)) : []
				}
			};
		}
		case "nsec": return {
			type: prefix,
			data
		};
		case "npub":
		case "note": return {
			type: prefix,
			data: bytesToHex$2(data)
		};
		default: throw new Error(`unknown prefix ${prefix}`);
	}
}
function parseTLV(data) {
	let result = {};
	let rest = data;
	while (rest.length > 0) {
		let t = rest[0];
		let l = rest[1];
		let v = rest.slice(2, 2 + l);
		rest = rest.slice(2 + l);
		if (v.length < l) throw new Error(`not enough data to read on TLV ${t}`);
		result[t] = result[t] || [];
		result[t].push(v);
	}
	return result;
}
function nsecEncode(key) {
	return encodeBytes("nsec", key);
}
function npubEncode(hex) {
	return encodeBytes("npub", hexToBytes$2(hex));
}
function noteEncode(hex) {
	return encodeBytes("note", hexToBytes$2(hex));
}
function encodeBech32(prefix, data) {
	let words = bech32.toWords(data);
	return bech32.encode(prefix, words, Bech32MaxSize);
}
function encodeBytes(prefix, bytes) {
	return encodeBech32(prefix, bytes);
}
function nprofileEncode(profile) {
	return encodeBech32("nprofile", encodeTLV({
		0: [hexToBytes$2(profile.pubkey)],
		1: (profile.relays || []).map((url) => utf8Encoder.encode(url))
	}));
}
function neventEncode(event) {
	let kindArray;
	if (event.kind !== void 0) kindArray = integerToUint8Array(event.kind);
	return encodeBech32("nevent", encodeTLV({
		0: [hexToBytes$2(event.id)],
		1: (event.relays || []).map((url) => utf8Encoder.encode(url)),
		2: event.author ? [hexToBytes$2(event.author)] : [],
		3: kindArray ? [new Uint8Array(kindArray)] : []
	}));
}
function naddrEncode(addr) {
	let kind = /* @__PURE__ */ new ArrayBuffer(4);
	new DataView(kind).setUint32(0, addr.kind, false);
	return encodeBech32("naddr", encodeTLV({
		0: [utf8Encoder.encode(addr.identifier)],
		1: (addr.relays || []).map((url) => utf8Encoder.encode(url)),
		2: [hexToBytes$2(addr.pubkey)],
		3: [new Uint8Array(kind)]
	}));
}
function encodeTLV(tlv) {
	let entries = [];
	Object.entries(tlv).reverse().forEach(([t, vs]) => {
		vs.forEach((v) => {
			let entry = new Uint8Array(v.length + 2);
			entry.set([parseInt(t)], 0);
			entry.set([v.length], 1);
			entry.set(v, 2);
			entries.push(entry);
		});
	});
	return concatBytes$2(...entries);
}
__export({}, {
	decrypt: () => decrypt,
	encrypt: () => encrypt
});
function encrypt(secretKey, pubkey, text) {
	const privkey = secretKey instanceof Uint8Array ? secretKey : hexToBytes$2(secretKey);
	const normalizedKey = getNormalizedX(secp256k1$1.getSharedSecret(privkey, hexToBytes$2("02" + pubkey)));
	let iv = Uint8Array.from(randomBytes$2(16));
	let plaintext = utf8Encoder.encode(text);
	let ciphertext = cbc(normalizedKey, iv).encrypt(plaintext);
	return `${base64$1.encode(new Uint8Array(ciphertext))}?iv=${base64$1.encode(new Uint8Array(iv.buffer))}`;
}
function decrypt(secretKey, pubkey, data) {
	const privkey = secretKey instanceof Uint8Array ? secretKey : hexToBytes$2(secretKey);
	let [ctb64, ivb64] = data.split("?iv=");
	let normalizedKey = getNormalizedX(secp256k1$1.getSharedSecret(privkey, hexToBytes$2("02" + pubkey)));
	let iv = base64$1.decode(ivb64);
	let ciphertext = base64$1.decode(ctb64);
	let plaintext = cbc(normalizedKey, iv).decrypt(ciphertext);
	return utf8Decoder.decode(plaintext);
}
function getNormalizedX(key) {
	return key.slice(1, 33);
}
__export({}, {
	NIP05_REGEX: () => NIP05_REGEX,
	isNip05: () => isNip05,
	isValid: () => isValid,
	queryProfile: () => queryProfile,
	searchDomain: () => searchDomain,
	useFetchImplementation: () => useFetchImplementation
});
var NIP05_REGEX = /^(?:([\w.+-]+)@)?([\w_-]+(\.[\w_-]+)+)$/;
var isNip05 = (value) => NIP05_REGEX.test(value || "");
var _fetch;
try {
	_fetch = fetch;
} catch (_) {}
function useFetchImplementation(fetchImplementation) {
	_fetch = fetchImplementation;
}
async function searchDomain(domain, query = "") {
	try {
		const url = `https://${domain}/.well-known/nostr.json?name=${query}`;
		const res = await _fetch(url, { redirect: "manual" });
		if (res.status !== 200) throw Error("Wrong response code");
		return (await res.json()).names;
	} catch (_) {
		return {};
	}
}
async function queryProfile(fullname) {
	const match = fullname.match(NIP05_REGEX);
	if (!match) return null;
	const [, name = "_", domain] = match;
	try {
		const url = `https://${domain}/.well-known/nostr.json?name=${name}`;
		const res = await _fetch(url, { redirect: "manual" });
		if (res.status !== 200) throw Error("Wrong response code");
		const json = await res.json();
		const pubkey = json.names[name];
		return pubkey ? {
			pubkey,
			relays: json.relays?.[pubkey]
		} : null;
	} catch (_e) {
		return null;
	}
}
async function isValid(pubkey, nip05) {
	const res = await queryProfile(nip05);
	return res ? res.pubkey === pubkey : false;
}
__export({}, { parse: () => parse$1 });
function parse$1(event) {
	const result = {
		reply: void 0,
		root: void 0,
		mentions: [],
		profiles: [],
		quotes: []
	};
	let maybeParent;
	let maybeRoot;
	for (let i2 = event.tags.length - 1; i2 >= 0; i2--) {
		const tag = event.tags[i2];
		if (tag[0] === "e" && tag[1]) {
			const [_, eTagEventId, eTagRelayUrl, eTagMarker, eTagAuthor] = tag;
			const eventPointer = {
				id: eTagEventId,
				relays: eTagRelayUrl ? [eTagRelayUrl] : [],
				author: eTagAuthor
			};
			if (eTagMarker === "root") {
				result.root = eventPointer;
				continue;
			}
			if (eTagMarker === "reply") {
				result.reply = eventPointer;
				continue;
			}
			if (eTagMarker === "mention") {
				result.mentions.push(eventPointer);
				continue;
			}
			if (!maybeParent) maybeParent = eventPointer;
			else maybeRoot = eventPointer;
			result.mentions.push(eventPointer);
			continue;
		}
		if (tag[0] === "q" && tag[1]) {
			const [_, eTagEventId, eTagRelayUrl] = tag;
			result.quotes.push({
				id: eTagEventId,
				relays: eTagRelayUrl ? [eTagRelayUrl] : []
			});
		}
		if (tag[0] === "p" && tag[1]) {
			result.profiles.push({
				pubkey: tag[1],
				relays: tag[2] ? [tag[2]] : []
			});
			continue;
		}
	}
	if (!result.root) result.root = maybeRoot || maybeParent || result.reply;
	if (!result.reply) result.reply = maybeParent || result.root;
	[result.reply, result.root].forEach((ref) => {
		if (!ref) return;
		let idx = result.mentions.indexOf(ref);
		if (idx !== -1) result.mentions.splice(idx, 1);
		if (ref.author) {
			let author = result.profiles.find((p) => p.pubkey === ref.author);
			if (author && author.relays) {
				if (!ref.relays) ref.relays = [];
				author.relays.forEach((url) => {
					if (ref.relays?.indexOf(url) === -1) ref.relays.push(url);
				});
				author.relays = ref.relays;
			}
		}
	});
	result.mentions.forEach((ref) => {
		if (ref.author) {
			let author = result.profiles.find((p) => p.pubkey === ref.author);
			if (author && author.relays) {
				if (!ref.relays) ref.relays = [];
				author.relays.forEach((url) => {
					if (ref.relays.indexOf(url) === -1) ref.relays.push(url);
				});
				author.relays = ref.relays;
			}
		}
	});
	return result;
}
__export({}, {
	fetchRelayInformation: () => fetchRelayInformation,
	useFetchImplementation: () => useFetchImplementation2
});
function useFetchImplementation2(fetchImplementation) {}
async function fetchRelayInformation(url) {
	return await (await fetch(url.replace("ws://", "http://").replace("wss://", "https://"), { headers: { Accept: "application/nostr+json" } })).json();
}
__export({}, {
	getPow: () => getPow,
	minePow: () => minePow
});
function getPow(hex) {
	let count = 0;
	for (let i2 = 0; i2 < 64; i2 += 8) {
		const nibble = parseInt(hex.substring(i2, i2 + 8), 16);
		if (nibble === 0) count += 32;
		else {
			count += Math.clz32(nibble);
			break;
		}
	}
	return count;
}
function getPowFromBytes(hash) {
	let count = 0;
	for (let i2 = 0; i2 < hash.length; i2++) {
		const byte = hash[i2];
		if (byte === 0) count += 8;
		else {
			count += Math.clz32(byte) - 24;
			break;
		}
	}
	return count;
}
function minePow(unsigned, difficulty) {
	let count = 0;
	const event = unsigned;
	const tag = [
		"nonce",
		count.toString(),
		difficulty.toString()
	];
	event.tags.push(tag);
	while (true) {
		const now2 = Math.floor((/* @__PURE__ */ new Date()).getTime() / 1e3);
		if (now2 !== event.created_at) {
			count = 0;
			event.created_at = now2;
		}
		tag[1] = (++count).toString();
		const hash = sha256$1(utf8Encoder.encode(JSON.stringify([
			0,
			event.pubkey,
			event.created_at,
			event.kind,
			event.tags,
			event.content
		])));
		if (getPowFromBytes(hash) >= difficulty) {
			event.id = bytesToHex$2(hash);
			break;
		}
	}
	return event;
}
__export({}, {
	unwrapEvent: () => unwrapEvent2,
	unwrapManyEvents: () => unwrapManyEvents2,
	wrapEvent: () => wrapEvent2,
	wrapManyEvents: () => wrapManyEvents2
});
__export({}, {
	createRumor: () => createRumor,
	createSeal: () => createSeal,
	createWrap: () => createWrap,
	unwrapEvent: () => unwrapEvent,
	unwrapManyEvents: () => unwrapManyEvents,
	wrapEvent: () => wrapEvent,
	wrapManyEvents: () => wrapManyEvents
});
__export({}, {
	decrypt: () => decrypt2,
	encrypt: () => encrypt2,
	getConversationKey: () => getConversationKey,
	v2: () => v2
});
var minPlaintextSize = 1;
var maxPlaintextSize = 4294967295;
var extendedPrefixThreshold = 65536;
function getConversationKey(privkeyA, pubkeyB) {
	return extract(sha256$1, secp256k1$1.getSharedSecret(privkeyA, hexToBytes$2("02" + pubkeyB)).subarray(1, 33), utf8Encoder.encode("nip44-v2"));
}
function getMessageKeys(conversationKey, nonce) {
	const keys = expand(sha256$1, conversationKey, nonce, 76);
	return {
		chacha_key: keys.subarray(0, 32),
		chacha_nonce: keys.subarray(32, 44),
		hmac_key: keys.subarray(44, 76)
	};
}
function calcPaddedLen(len) {
	if (!Number.isSafeInteger(len) || len < 1) throw new Error("expected positive integer");
	if (len <= 32) return 32;
	const nextPower = 2 ** (Math.floor(Math.log2(len - 1)) + 1);
	const chunk = nextPower <= 256 ? 32 : nextPower / 8;
	return chunk * (Math.floor((len - 1) / chunk) + 1);
}
function writeU16BE(num) {
	if (!Number.isSafeInteger(num) || num < minPlaintextSize || num > 65535) throw new Error("invalid plaintext size: must be between 1 and 65535 bytes");
	const arr = new Uint8Array(2);
	new DataView(arr.buffer).setUint16(0, num, false);
	return arr;
}
function writeU32BE(num) {
	if (!Number.isSafeInteger(num) || num < extendedPrefixThreshold || num > maxPlaintextSize) throw new Error("invalid plaintext size: must be between 65536 and 4294967295 bytes");
	const arr = new Uint8Array(4);
	new DataView(arr.buffer).setUint32(0, num, false);
	return arr;
}
function pad(plaintext) {
	const unpadded = utf8Encoder.encode(plaintext);
	const unpaddedLen = unpadded.length;
	if (unpaddedLen < minPlaintextSize || unpaddedLen > maxPlaintextSize) throw new Error("invalid plaintext size: must be between 1 and 4294967295 bytes");
	return concatBytes$2(unpaddedLen >= extendedPrefixThreshold ? concatBytes$2(new Uint8Array([0, 0]), writeU32BE(unpaddedLen)) : writeU16BE(unpaddedLen), unpadded, new Uint8Array(calcPaddedLen(unpaddedLen) - unpaddedLen));
}
function unpad(padded) {
	const dv = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
	const firstTwo = dv.getUint16(0);
	let unpaddedLen;
	let prefixLen;
	if (firstTwo === 0) {
		unpaddedLen = dv.getUint32(2);
		if (unpaddedLen < extendedPrefixThreshold) throw new Error("invalid padding");
		prefixLen = 6;
	} else {
		unpaddedLen = firstTwo;
		prefixLen = 2;
	}
	const unpadded = padded.subarray(prefixLen, prefixLen + unpaddedLen);
	if (unpaddedLen < minPlaintextSize || unpaddedLen > maxPlaintextSize || unpadded.length !== unpaddedLen || padded.length !== prefixLen + calcPaddedLen(unpaddedLen)) throw new Error("invalid padding");
	return utf8Decoder.decode(unpadded);
}
function hmacAad(key, message, aad) {
	if (aad.length !== 32) throw new Error("AAD associated data must be 32 bytes");
	return hmac$1(sha256$1, key, concatBytes$2(aad, message));
}
function decodePayload(payload) {
	if (typeof payload !== "string") throw new Error("payload must be a valid string");
	const plen = payload.length;
	if (plen < 132) throw new Error("invalid payload length: " + plen);
	if (payload[0] === "#") throw new Error("unknown encryption version");
	let data;
	try {
		data = base64$1.decode(payload);
	} catch (error) {
		throw new Error("invalid base64: " + error.message);
	}
	const dlen = data.length;
	if (dlen < 99) throw new Error("invalid data length: " + dlen);
	const vers = data[0];
	if (vers !== 2) throw new Error("unknown encryption version " + vers);
	return {
		nonce: data.subarray(1, 33),
		ciphertext: data.subarray(33, -32),
		mac: data.subarray(-32)
	};
}
function encrypt2(plaintext, conversationKey, nonce = randomBytes$2(32)) {
	const { chacha_key, chacha_nonce, hmac_key } = getMessageKeys(conversationKey, nonce);
	const ciphertext = chacha20(chacha_key, chacha_nonce, pad(plaintext));
	const mac = hmacAad(hmac_key, ciphertext, nonce);
	return base64$1.encode(concatBytes$2(new Uint8Array([2]), nonce, ciphertext, mac));
}
function decrypt2(payload, conversationKey) {
	const { nonce, ciphertext, mac } = decodePayload(payload);
	const { chacha_key, chacha_nonce, hmac_key } = getMessageKeys(conversationKey, nonce);
	if (!equalBytes(hmacAad(hmac_key, ciphertext, nonce), mac)) throw new Error("invalid MAC");
	return unpad(chacha20(chacha_key, chacha_nonce, ciphertext));
}
var v2 = {
	utils: {
		getConversationKey,
		calcPaddedLen,
		pad,
		unpad
	},
	encrypt: encrypt2,
	decrypt: decrypt2
};
var TWO_DAYS = 2880 * 60;
var now = () => Math.round(Date.now() / 1e3);
var randomNow = () => Math.round(now() - Math.random() * TWO_DAYS);
var nip44ConversationKey = (privateKey, publicKey) => getConversationKey(privateKey, publicKey);
var nip44Encrypt = (data, privateKey, publicKey) => encrypt2(JSON.stringify(data), nip44ConversationKey(privateKey, publicKey));
var nip44Decrypt = (data, privateKey) => JSON.parse(decrypt2(data.content, nip44ConversationKey(privateKey, data.pubkey)));
function createRumor(event, privateKey) {
	const rumor = {
		created_at: now(),
		content: "",
		tags: [],
		...event,
		pubkey: getPublicKey(privateKey)
	};
	rumor.id = getEventHash(rumor);
	return rumor;
}
function createSeal(rumor, privateKey, recipientPublicKey) {
	return finalizeEvent({
		kind: Seal,
		content: nip44Encrypt(rumor, privateKey, recipientPublicKey),
		created_at: randomNow(),
		tags: []
	}, privateKey);
}
function createWrap(seal, recipientPublicKey) {
	const randomKey = generateSecretKey();
	return finalizeEvent({
		kind: GiftWrap,
		content: nip44Encrypt(seal, randomKey, recipientPublicKey),
		created_at: randomNow(),
		tags: [["p", recipientPublicKey]]
	}, randomKey);
}
function wrapEvent(event, senderPrivateKey, recipientPublicKey) {
	return createWrap(createSeal(createRumor(event, senderPrivateKey), senderPrivateKey, recipientPublicKey), recipientPublicKey);
}
function wrapManyEvents(event, senderPrivateKey, recipientsPublicKeys) {
	if (!recipientsPublicKeys || recipientsPublicKeys.length === 0) throw new Error("At least one recipient is required.");
	const wrappeds = [wrapEvent(event, senderPrivateKey, getPublicKey(senderPrivateKey))];
	recipientsPublicKeys.forEach((recipientPublicKey) => {
		wrappeds.push(wrapEvent(event, senderPrivateKey, recipientPublicKey));
	});
	return wrappeds;
}
function unwrapEvent(wrap, recipientPrivateKey) {
	return nip44Decrypt(nip44Decrypt(wrap, recipientPrivateKey), recipientPrivateKey);
}
function unwrapManyEvents(wrappedEvents, recipientPrivateKey) {
	let unwrappedEvents = [];
	wrappedEvents.forEach((e) => {
		unwrappedEvents.push(unwrapEvent(e, recipientPrivateKey));
	});
	unwrappedEvents.sort((a, b) => a.created_at - b.created_at);
	return unwrappedEvents;
}
function createEvent(recipients, message, conversationTitle, replyTo) {
	const baseEvent = {
		created_at: Math.ceil(Date.now() / 1e3),
		kind: PrivateDirectMessage,
		tags: [],
		content: message
	};
	(Array.isArray(recipients) ? recipients : [recipients]).forEach(({ publicKey, relayUrl }) => {
		baseEvent.tags.push(relayUrl ? [
			"p",
			publicKey,
			relayUrl
		] : ["p", publicKey]);
	});
	if (replyTo) baseEvent.tags.push([
		"e",
		replyTo.eventId,
		replyTo.relayUrl || "",
		"reply"
	]);
	if (conversationTitle) baseEvent.tags.push(["subject", conversationTitle]);
	return baseEvent;
}
function wrapEvent2(senderPrivateKey, recipient, message, conversationTitle, replyTo) {
	return wrapEvent(createEvent(recipient, message, conversationTitle, replyTo), senderPrivateKey, recipient.publicKey);
}
function wrapManyEvents2(senderPrivateKey, recipients, message, conversationTitle, replyTo) {
	if (!recipients || recipients.length === 0) throw new Error("At least one recipient is required.");
	return [{ publicKey: getPublicKey(senderPrivateKey) }, ...recipients].map((recipient) => wrapEvent2(senderPrivateKey, recipient, message, conversationTitle, replyTo));
}
var unwrapEvent2 = unwrapEvent;
var unwrapManyEvents2 = unwrapManyEvents;
__export({}, {
	finishRepostEvent: () => finishRepostEvent,
	getRepostedEvent: () => getRepostedEvent,
	getRepostedEventPointer: () => getRepostedEventPointer
});
function finishRepostEvent(t, reposted, relayUrl, privateKey) {
	let kind;
	const tags = [
		...t.tags ?? [],
		[
			"e",
			reposted.id,
			relayUrl
		],
		["p", reposted.pubkey]
	];
	if (reposted.kind === ShortTextNote) kind = Repost;
	else {
		kind = GenericRepost;
		tags.push(["k", String(reposted.kind)]);
	}
	return finalizeEvent({
		kind,
		tags,
		content: t.content === "" || reposted.tags?.find((tag) => tag[0] === "-") ? "" : JSON.stringify(reposted),
		created_at: t.created_at
	}, privateKey);
}
function getRepostedEventPointer(event) {
	if (![Repost, GenericRepost].includes(event.kind)) return;
	let lastETag;
	let lastPTag;
	for (let i2 = event.tags.length - 1; i2 >= 0 && (lastETag === void 0 || lastPTag === void 0); i2--) {
		const tag = event.tags[i2];
		if (tag.length >= 2) {
			if (tag[0] === "e" && lastETag === void 0) lastETag = tag;
			else if (tag[0] === "p" && lastPTag === void 0) lastPTag = tag;
		}
	}
	if (lastETag === void 0) return;
	return {
		id: lastETag[1],
		relays: [lastETag[2], lastPTag?.[2]].filter((x) => typeof x === "string"),
		author: lastPTag?.[1]
	};
}
function getRepostedEvent(event, { skipVerification } = {}) {
	const pointer = getRepostedEventPointer(event);
	if (pointer === void 0 || event.content === "") return;
	let repostedEvent;
	try {
		repostedEvent = JSON.parse(event.content);
	} catch (error) {
		return;
	}
	if (repostedEvent.id !== pointer.id) return;
	if (!skipVerification && !verifyEvent(repostedEvent)) return;
	return repostedEvent;
}
__export({}, {
	NOSTR_URI_REGEX: () => NOSTR_URI_REGEX,
	parse: () => parse2,
	test: () => test
});
var NOSTR_URI_REGEX = new RegExp(`nostr:(${BECH32_REGEX.source})`);
function test(value) {
	return typeof value === "string" && new RegExp(`^${NOSTR_URI_REGEX.source}$`).test(value);
}
function parse2(uri) {
	const match = uri.match(new RegExp(`^${NOSTR_URI_REGEX.source}$`));
	if (!match) throw new Error(`Invalid Nostr URI: ${uri}`);
	return {
		uri: match[0],
		value: match[1],
		decoded: decode$1(match[1])
	};
}
__export({}, { parse: () => parse3 });
function parseKind(kind) {
	if (!kind) return void 0;
	return /^\d+$/.test(kind) ? parseInt(kind, 10) : kind;
}
function parseAddressPointer(value, relayUrl) {
	const idx = value.indexOf(":");
	const idx2 = value.indexOf(":", idx + 1);
	if (idx === -1 || idx2 === -1) return void 0;
	const kind = parseInt(value.slice(0, idx), 10);
	if (Number.isNaN(kind)) return void 0;
	return {
		kind,
		pubkey: value.slice(idx + 1, idx2),
		identifier: value.slice(idx2 + 1),
		relays: relayUrl ? [relayUrl] : []
	};
}
function parsePointer(tag) {
	switch (tag[0]) {
		case "E":
		case "e":
			if (!tag[1]) return void 0;
			return {
				id: tag[1],
				relays: tag[2] ? [tag[2]] : [],
				author: tag[3]
			};
		case "A":
		case "a":
			if (!tag[1]) return void 0;
			return parseAddressPointer(tag[1], tag[2]);
		case "I":
		case "i":
			if (!tag[1]) return void 0;
			return {
				value: tag[1],
				hint: tag[2]
			};
	}
}
function parseQuote(tag) {
	if (!tag[1]) return void 0;
	if (tag[1].includes(":")) return parseAddressPointer(tag[1], tag[2]);
	return {
		id: tag[1],
		relays: tag[2] ? [tag[2]] : [],
		author: tag[3]
	};
}
function choosePointer(candidates) {
	return candidates.findLast((candidate) => candidate.tagName === "A" || candidate.tagName === "a")?.pointer || candidates.findLast((candidate) => candidate.tagName === "I" || candidate.tagName === "i")?.pointer || candidates.findLast((candidate) => candidate.tagName === "E" || candidate.tagName === "e")?.pointer;
}
function inheritRelayHints(pointer, profiles) {
	if (!pointer || !("id" in pointer) || !pointer.author) return;
	const author = profiles.find((profile) => profile.pubkey === pointer.author);
	if (!author || !author.relays) return;
	if (!pointer.relays) pointer.relays = [];
	author.relays.forEach((url) => {
		if (pointer.relays.indexOf(url) === -1) pointer.relays.push(url);
	});
	author.relays = pointer.relays;
}
function parse3(event) {
	const result = {
		root: void 0,
		rootKind: void 0,
		reply: void 0,
		replyKind: void 0,
		mentions: [],
		quotes: [],
		profiles: []
	};
	const rootCandidates = [];
	const replyCandidates = [];
	for (const tag of event.tags) {
		if ((tag[0] === "E" || tag[0] === "A" || tag[0] === "I") && tag[1]) {
			const pointer = parsePointer(tag);
			if (pointer) rootCandidates.push({
				tagName: tag[0],
				pointer
			});
			continue;
		}
		if ((tag[0] === "e" || tag[0] === "a" || tag[0] === "i") && tag[1]) {
			const pointer = parsePointer(tag);
			if (pointer) replyCandidates.push({
				tagName: tag[0],
				pointer
			});
			continue;
		}
		if (tag[0] === "K") {
			result.rootKind = parseKind(tag[1]);
			continue;
		}
		if (tag[0] === "k") {
			result.replyKind = parseKind(tag[1]);
			continue;
		}
		if (tag[0] === "q") {
			const pointer = parseQuote(tag);
			if (pointer) result.quotes.push(pointer);
			continue;
		}
		if ((tag[0] === "P" || tag[0] === "p") && tag[1]) result.profiles.push({
			pubkey: tag[1],
			relays: tag[2] ? [tag[2]] : []
		});
	}
	result.root = choosePointer(rootCandidates);
	result.reply = choosePointer(replyCandidates);
	inheritRelayHints(result.root, result.profiles);
	inheritRelayHints(result.reply, result.profiles);
	result.quotes.forEach((pointer) => inheritRelayHints(pointer, result.profiles));
	return result;
}
__export({}, {
	finishReactionEvent: () => finishReactionEvent,
	getReactedEventPointer: () => getReactedEventPointer
});
function finishReactionEvent(t, reacted, privateKey) {
	const inheritedTags = reacted.tags.filter((tag) => tag.length >= 2 && (tag[0] === "e" || tag[0] === "p"));
	return finalizeEvent({
		...t,
		kind: Reaction,
		tags: [
			...t.tags ?? [],
			...inheritedTags,
			["e", reacted.id],
			["p", reacted.pubkey]
		],
		content: t.content ?? "+"
	}, privateKey);
}
function getReactedEventPointer(event) {
	if (event.kind !== Reaction) return;
	let lastETag;
	let lastPTag;
	for (let i2 = event.tags.length - 1; i2 >= 0 && (lastETag === void 0 || lastPTag === void 0); i2--) {
		const tag = event.tags[i2];
		if (tag.length >= 2) {
			if (tag[0] === "e" && lastETag === void 0) lastETag = tag;
			else if (tag[0] === "p" && lastPTag === void 0) lastPTag = tag;
		}
	}
	if (lastETag === void 0 || lastPTag === void 0) return;
	return {
		id: lastETag[1],
		relays: [lastETag[2], lastPTag[2]].filter((x) => x !== void 0),
		author: lastPTag[1]
	};
}
__export({}, { parse: () => parse4 });
var noCharacter = /\W/m;
var noURLCharacter = /[^\w\/] |[^\w\/]$|$|,| /m;
var MAX_HASHTAG_LENGTH = 42;
function* parse4(content) {
	let emojis = [];
	if (typeof content !== "string") {
		for (let i2 = 0; i2 < content.tags.length; i2++) {
			const tag = content.tags[i2];
			if (tag[0] === "emoji" && tag.length >= 3) emojis.push({
				type: "emoji",
				shortcode: tag[1],
				url: tag[2]
			});
		}
		content = content.content;
	}
	const max = content.length;
	let prevIndex = 0;
	let index = 0;
	mainloop: while (index < max) {
		const u = content.indexOf(":", index);
		const h = content.indexOf("#", index);
		if (u === -1 && h === -1) break mainloop;
		if (u === -1 || h >= 0 && h < u) {
			if (h === 0 || content[h - 1].match(noCharacter)) {
				const m = content.slice(h + 1, h + MAX_HASHTAG_LENGTH).match(noCharacter);
				const end = m ? h + 1 + m.index : max;
				yield {
					type: "text",
					text: content.slice(prevIndex, h)
				};
				yield {
					type: "hashtag",
					value: content.slice(h + 1, end)
				};
				index = end;
				prevIndex = index;
				continue mainloop;
			}
			index = h + 1;
			continue mainloop;
		}
		if (content.slice(u - 5, u) === "nostr") {
			const m = content.slice(u + 60).match(noCharacter);
			const end = m ? u + 60 + m.index : max;
			try {
				let pointer;
				let { data, type } = decode$1(content.slice(u + 1, end));
				switch (type) {
					case "npub":
						pointer = { pubkey: data };
						break;
					case "note":
						pointer = { id: data };
						break;
					case "nsec":
						index = end + 1;
						continue;
					default: pointer = data;
				}
				if (prevIndex !== u - 5) yield {
					type: "text",
					text: content.slice(prevIndex, u - 5)
				};
				yield {
					type: "reference",
					pointer
				};
				index = end;
				prevIndex = index;
				continue mainloop;
			} catch (_err) {
				index = u + 1;
				continue mainloop;
			}
		} else if (content.slice(u - 5, u) === "https" || content.slice(u - 4, u) === "http") {
			const m = content.slice(u + 4).match(noURLCharacter);
			const end = m ? u + 4 + m.index : max;
			const prefixLen = content[u - 1] === "s" ? 5 : 4;
			try {
				let url = new URL(content.slice(u - prefixLen, end));
				if (url.hostname.indexOf(".") === -1) throw new Error("invalid url");
				if (prevIndex !== u - prefixLen) yield {
					type: "text",
					text: content.slice(prevIndex, u - prefixLen)
				};
				if (/\.(png|jpe?g|gif|webp|heic|svg)$/i.test(url.pathname)) {
					yield {
						type: "image",
						url: url.toString()
					};
					index = end;
					prevIndex = index;
					continue mainloop;
				}
				if (/\.(mp4|avi|webm|mkv|mov)$/i.test(url.pathname)) {
					yield {
						type: "video",
						url: url.toString()
					};
					index = end;
					prevIndex = index;
					continue mainloop;
				}
				if (/\.(mp3|aac|ogg|opus|wav|flac)$/i.test(url.pathname)) {
					yield {
						type: "audio",
						url: url.toString()
					};
					index = end;
					prevIndex = index;
					continue mainloop;
				}
				yield {
					type: "url",
					url: url.toString()
				};
				index = end;
				prevIndex = index;
				continue mainloop;
			} catch (_err) {
				index = end + 1;
				continue mainloop;
			}
		} else if (content.slice(u - 3, u) === "wss" || content.slice(u - 2, u) === "ws") {
			const m = content.slice(u + 4).match(noURLCharacter);
			const end = m ? u + 4 + m.index : max;
			const prefixLen = content[u - 1] === "s" ? 3 : 2;
			try {
				let url = new URL(content.slice(u - prefixLen, end));
				if (url.hostname.indexOf(".") === -1) throw new Error("invalid ws url");
				if (prevIndex !== u - prefixLen) yield {
					type: "text",
					text: content.slice(prevIndex, u - prefixLen)
				};
				yield {
					type: "relay",
					url: url.toString()
				};
				index = end;
				prevIndex = index;
				continue mainloop;
			} catch (_err) {
				index = end + 1;
				continue mainloop;
			}
		} else {
			for (let e = 0; e < emojis.length; e++) {
				const emoji = emojis[e];
				if (content[u + emoji.shortcode.length + 1] === ":" && content.slice(u + 1, u + emoji.shortcode.length + 1) === emoji.shortcode) {
					if (prevIndex !== u) yield {
						type: "text",
						text: content.slice(prevIndex, u)
					};
					yield emoji;
					index = u + emoji.shortcode.length + 2;
					prevIndex = index;
					continue mainloop;
				}
			}
			index = u + 1;
			continue mainloop;
		}
	}
	if (prevIndex !== max) yield {
		type: "text",
		text: content.slice(prevIndex)
	};
}
__export({}, {
	channelCreateEvent: () => channelCreateEvent,
	channelHideMessageEvent: () => channelHideMessageEvent,
	channelMessageEvent: () => channelMessageEvent,
	channelMetadataEvent: () => channelMetadataEvent,
	channelMuteUserEvent: () => channelMuteUserEvent
});
var channelCreateEvent = (t, privateKey) => {
	let content;
	if (typeof t.content === "object") content = JSON.stringify(t.content);
	else if (typeof t.content === "string") content = t.content;
	else return;
	return finalizeEvent({
		kind: ChannelCreation,
		tags: [...t.tags ?? []],
		content,
		created_at: t.created_at
	}, privateKey);
};
var channelMetadataEvent = (t, privateKey) => {
	let content;
	if (typeof t.content === "object") content = JSON.stringify(t.content);
	else if (typeof t.content === "string") content = t.content;
	else return;
	return finalizeEvent({
		kind: ChannelMetadata,
		tags: [["e", t.channel_create_event_id], ...t.tags ?? []],
		content,
		created_at: t.created_at
	}, privateKey);
};
var channelMessageEvent = (t, privateKey) => {
	const tags = [[
		"e",
		t.channel_create_event_id,
		t.relay_url,
		"root"
	]];
	if (t.reply_to_channel_message_event_id) tags.push([
		"e",
		t.reply_to_channel_message_event_id,
		t.relay_url,
		"reply"
	]);
	return finalizeEvent({
		kind: ChannelMessage,
		tags: [...tags, ...t.tags ?? []],
		content: t.content,
		created_at: t.created_at
	}, privateKey);
};
var channelHideMessageEvent = (t, privateKey) => {
	let content;
	if (typeof t.content === "object") content = JSON.stringify(t.content);
	else if (typeof t.content === "string") content = t.content;
	else return;
	return finalizeEvent({
		kind: ChannelHideMessage,
		tags: [["e", t.channel_message_event_id], ...t.tags ?? []],
		content,
		created_at: t.created_at
	}, privateKey);
};
var channelMuteUserEvent = (t, privateKey) => {
	let content;
	if (typeof t.content === "object") content = JSON.stringify(t.content);
	else if (typeof t.content === "string") content = t.content;
	else return;
	return finalizeEvent({
		kind: ChannelMuteUser,
		tags: [["p", t.pubkey_to_mute], ...t.tags ?? []],
		content,
		created_at: t.created_at
	}, privateKey);
};
__export({}, {
	EMOJI_SHORTCODE_REGEX: () => EMOJI_SHORTCODE_REGEX,
	matchAll: () => matchAll,
	regex: () => regex,
	replaceAll: () => replaceAll
});
var EMOJI_SHORTCODE_REGEX = /:(\w+):/;
var regex = () => new RegExp(`\\B${EMOJI_SHORTCODE_REGEX.source}\\B`, "g");
function* matchAll(content) {
	const matches = content.matchAll(regex());
	for (const match of matches) try {
		const [shortcode, name] = match;
		yield {
			shortcode,
			name,
			start: match.index,
			end: match.index + shortcode.length
		};
	} catch (_e) {}
}
function replaceAll(content, replacer) {
	return content.replaceAll(regex(), (shortcode, name) => {
		return replacer({
			shortcode,
			name
		});
	});
}
__export({}, {
	useFetchImplementation: () => useFetchImplementation3,
	validateGithub: () => validateGithub
});
var _fetch3;
try {
	_fetch3 = fetch;
} catch {}
function useFetchImplementation3(fetchImplementation) {
	_fetch3 = fetchImplementation;
}
async function validateGithub(pubkey, username, proof) {
	try {
		return await (await _fetch3(`https://gist.github.com/${username}/${proof}/raw`)).text() === `Verifying that I control the following Nostr public key: ${pubkey}`;
	} catch (_) {
		return false;
	}
}
__export({}, {
	makeNwcRequestEvent: () => makeNwcRequestEvent,
	parseConnectionString: () => parseConnectionString
});
function parseConnectionString(connectionString) {
	const { host, pathname, searchParams } = new URL(connectionString);
	const pubkey = pathname || host;
	const relays = searchParams.getAll("relay");
	const secret = searchParams.get("secret");
	if (!pubkey || relays.length === 0 || !secret) throw new Error("invalid connection string");
	return {
		pubkey,
		relay: relays[0],
		relays,
		secret
	};
}
async function makeNwcRequestEvent(pubkey, secretKey, invoice) {
	const encryptedContent = encrypt(secretKey, pubkey, JSON.stringify({
		method: "pay_invoice",
		params: { invoice }
	}));
	return finalizeEvent({
		kind: NWCWalletRequest,
		created_at: Math.round(Date.now() / 1e3),
		content: encryptedContent,
		tags: [["p", pubkey]]
	}, secretKey);
}
__export({}, { normalizeIdentifier: () => normalizeIdentifier });
function normalizeIdentifier(name) {
	name = name.trim().toLowerCase();
	name = name.normalize("NFKC");
	return Array.from(name).map((char) => {
		if (/\p{Letter}/u.test(char) || /\p{Number}/u.test(char)) return char;
		return "-";
	}).join("");
}
__export({}, {
	getSatoshisAmountFromBolt11: () => getSatoshisAmountFromBolt11,
	getZapEndpoint: () => getZapEndpoint,
	makeZapReceipt: () => makeZapReceipt,
	makeZapRequest: () => makeZapRequest,
	useFetchImplementation: () => useFetchImplementation4,
	validateZapRequest: () => validateZapRequest
});
var _fetch4;
try {
	_fetch4 = fetch;
} catch {}
function useFetchImplementation4(fetchImplementation) {
	_fetch4 = fetchImplementation;
}
async function getZapEndpoint(metadata) {
	try {
		let lnurl = "";
		let { lud06, lud16 } = JSON.parse(metadata.content);
		if (lud16) {
			let [name, domain] = lud16.split("@");
			lnurl = new URL(`/.well-known/lnurlp/${name}`, `https://${domain}`).toString();
		} else if (lud06) {
			let { words } = bech32.decode(lud06, 1e3);
			let data = bech32.fromWords(words);
			lnurl = utf8Decoder.decode(data);
		} else return null;
		let body = await (await _fetch4(lnurl)).json();
		if (body.allowsNostr && body.nostrPubkey) return body.callback;
	} catch (err) {}
	return null;
}
function makeZapRequest(params) {
	let zr = {
		kind: 9734,
		created_at: Math.round(Date.now() / 1e3),
		content: params.comment || "",
		tags: [
			["p", "pubkey" in params ? params.pubkey : params.event.pubkey],
			["amount", params.amount.toString()],
			["relays", ...params.relays]
		]
	};
	if ("event" in params) {
		zr.tags.push(["e", params.event.id]);
		if (isReplaceableKind(params.event.kind)) {
			const a = ["a", `${params.event.kind}:${params.event.pubkey}:`];
			zr.tags.push(a);
		} else if (isAddressableKind(params.event.kind)) {
			let d = params.event.tags.find(([t, v]) => t === "d" && v);
			if (!d) throw new Error("d tag not found or is empty");
			const a = ["a", `${params.event.kind}:${params.event.pubkey}:${d[1]}`];
			zr.tags.push(a);
		}
		zr.tags.push(["k", params.event.kind.toString()]);
	}
	return zr;
}
function validateZapRequest(zapRequestString) {
	let zapRequest;
	try {
		zapRequest = JSON.parse(zapRequestString);
	} catch (err) {
		return "Invalid zap request JSON.";
	}
	if (!validateEvent(zapRequest)) return "Zap request is not a valid Nostr event.";
	if (!verifyEvent(zapRequest)) return "Invalid signature on zap request.";
	let p = zapRequest.tags.find(([t, v]) => t === "p" && v);
	if (!p) return "Zap request doesn't have a 'p' tag.";
	if (!p[1].match(/^[a-f0-9]{64}$/)) return "Zap request 'p' tag is not valid hex.";
	let e = zapRequest.tags.find(([t, v]) => t === "e" && v);
	if (e && !e[1].match(/^[a-f0-9]{64}$/)) return "Zap request 'e' tag is not valid hex.";
	if (!zapRequest.tags.find(([t, v]) => t === "relays" && v)) return "Zap request doesn't have a 'relays' tag.";
	return null;
}
function makeZapReceipt({ zapRequest, preimage, bolt11, paidAt }) {
	let zr = JSON.parse(zapRequest);
	let tagsFromZapRequest = zr.tags.filter(([t]) => t === "e" || t === "p" || t === "a");
	let zap = {
		kind: 9735,
		created_at: Math.round(paidAt.getTime() / 1e3),
		content: "",
		tags: [
			...tagsFromZapRequest,
			["P", zr.pubkey],
			["bolt11", bolt11],
			["description", zapRequest]
		]
	};
	if (preimage) zap.tags.push(["preimage", preimage]);
	return zap;
}
function getSatoshisAmountFromBolt11(bolt11) {
	if (bolt11.length < 50) return 0;
	bolt11 = bolt11.substring(0, 50);
	const idx = bolt11.lastIndexOf("1");
	if (idx === -1) return 0;
	const hrp = bolt11.substring(0, idx);
	if (!hrp.startsWith("lnbc")) return 0;
	const amount = hrp.substring(4);
	if (amount.length < 1) return 0;
	const char = amount[amount.length - 1];
	const digit = char.charCodeAt(0) - "0".charCodeAt(0);
	const isDigit = digit >= 0 && digit <= 9;
	let cutPoint = amount.length - 1;
	if (isDigit) cutPoint++;
	if (cutPoint < 1) return 0;
	const num = parseInt(amount.substring(0, cutPoint));
	switch (char) {
		case "m": return num * 1e5;
		case "u": return num * 100;
		case "n": return num / 10;
		case "p": return num / 1e4;
		default: return num * 1e8;
	}
}
__export({}, {
	Negentropy: () => Negentropy,
	NegentropyStorageVector: () => NegentropyStorageVector,
	NegentropySync: () => NegentropySync
});
var PROTOCOL_VERSION$1 = 97;
var ID_SIZE = 32;
var FINGERPRINT_SIZE = 16;
var Mode = {
	Skip: 0,
	Fingerprint: 1,
	IdList: 2
};
var WrappedBuffer = class {
	_raw;
	length;
	constructor(buffer) {
		if (typeof buffer === "number") {
			this._raw = new Uint8Array(buffer);
			this.length = 0;
		} else if (buffer instanceof Uint8Array) {
			this._raw = new Uint8Array(buffer);
			this.length = buffer.length;
		} else {
			this._raw = new Uint8Array(512);
			this.length = 0;
		}
	}
	unwrap() {
		return this._raw.subarray(0, this.length);
	}
	get capacity() {
		return this._raw.byteLength;
	}
	extend(buf) {
		if (buf instanceof WrappedBuffer) buf = buf.unwrap();
		if (typeof buf.length !== "number") throw Error("bad length");
		const targetSize = buf.length + this.length;
		if (this.capacity < targetSize) {
			const oldRaw = this._raw;
			const newCapacity = Math.max(this.capacity * 2, targetSize);
			this._raw = new Uint8Array(newCapacity);
			this._raw.set(oldRaw);
		}
		this._raw.set(buf, this.length);
		this.length += buf.length;
	}
	shift() {
		const first = this._raw[0];
		this._raw = this._raw.subarray(1);
		this.length--;
		return first;
	}
	shiftN(n = 1) {
		const firstSubarray = this._raw.subarray(0, n);
		this._raw = this._raw.subarray(n);
		this.length -= n;
		return firstSubarray;
	}
};
function decodeVarInt(buf) {
	let res = 0;
	while (1) {
		if (buf.length === 0) throw Error("parse ends prematurely");
		let byte = buf.shift();
		res = res << 7 | byte & 127;
		if ((byte & 128) === 0) break;
	}
	return res;
}
function encodeVarInt(n) {
	if (n === 0) return new WrappedBuffer(new Uint8Array([0]));
	let o = [];
	while (n !== 0) {
		o.push(n & 127);
		n >>>= 7;
	}
	o.reverse();
	for (let i2 = 0; i2 < o.length - 1; i2++) o[i2] |= 128;
	return new WrappedBuffer(new Uint8Array(o));
}
function getByte(buf) {
	return getBytes(buf, 1)[0];
}
function getBytes(buf, n) {
	if (buf.length < n) throw Error("parse ends prematurely");
	return buf.shiftN(n);
}
var Accumulator = class {
	buf;
	constructor() {
		this.setToZero();
	}
	setToZero() {
		this.buf = new Uint8Array(ID_SIZE);
	}
	add(otherBuf) {
		let currCarry = 0, nextCarry = 0;
		let p = new DataView(this.buf.buffer);
		let po = new DataView(otherBuf.buffer);
		for (let i2 = 0; i2 < 8; i2++) {
			let offset = i2 * 4;
			let orig = p.getUint32(offset, true);
			let otherV = po.getUint32(offset, true);
			let next = orig;
			next += currCarry;
			next += otherV;
			if (next > 4294967295) nextCarry = 1;
			p.setUint32(offset, next & 4294967295, true);
			currCarry = nextCarry;
			nextCarry = 0;
		}
	}
	negate() {
		let p = new DataView(this.buf.buffer);
		for (let i2 = 0; i2 < 8; i2++) {
			let offset = i2 * 4;
			p.setUint32(offset, ~p.getUint32(offset, true));
		}
		let one = new Uint8Array(ID_SIZE);
		one[0] = 1;
		this.add(one);
	}
	getFingerprint(n) {
		let input = new WrappedBuffer();
		input.extend(this.buf);
		input.extend(encodeVarInt(n));
		return sha256$1(input.unwrap()).subarray(0, FINGERPRINT_SIZE);
	}
};
var NegentropyStorageVector = class {
	items;
	sealed;
	constructor() {
		this.items = [];
		this.sealed = false;
	}
	insert(timestamp, id) {
		if (this.sealed) throw Error("already sealed");
		const idb = hexToBytes$2(id);
		if (idb.byteLength !== ID_SIZE) throw Error("bad id size for added item");
		this.items.push({
			timestamp,
			id: idb
		});
	}
	seal() {
		if (this.sealed) throw Error("already sealed");
		this.sealed = true;
		this.items.sort(itemCompare);
		for (let i2 = 1; i2 < this.items.length; i2++) if (itemCompare(this.items[i2 - 1], this.items[i2]) === 0) throw Error("duplicate item inserted");
	}
	unseal() {
		this.sealed = false;
	}
	size() {
		this._checkSealed();
		return this.items.length;
	}
	getItem(i2) {
		this._checkSealed();
		if (i2 >= this.items.length) throw Error("out of range");
		return this.items[i2];
	}
	iterate(begin, end, cb) {
		this._checkSealed();
		this._checkBounds(begin, end);
		for (let i2 = begin; i2 < end; ++i2) if (!cb(this.items[i2], i2)) break;
	}
	findLowerBound(begin, end, bound) {
		this._checkSealed();
		this._checkBounds(begin, end);
		return this._binarySearch(this.items, begin, end, (a) => itemCompare(a, bound) < 0);
	}
	fingerprint(begin, end) {
		let out = new Accumulator();
		out.setToZero();
		this.iterate(begin, end, (item) => {
			out.add(item.id);
			return true;
		});
		return out.getFingerprint(end - begin);
	}
	_checkSealed() {
		if (!this.sealed) throw Error("not sealed");
	}
	_checkBounds(begin, end) {
		if (begin > end || end > this.items.length) throw Error("bad range");
	}
	_binarySearch(arr, first, last, cmp) {
		let count = last - first;
		while (count > 0) {
			let it = first;
			let step = Math.floor(count / 2);
			it += step;
			if (cmp(arr[it])) {
				first = ++it;
				count -= step + 1;
			} else count = step;
		}
		return first;
	}
};
var Negentropy = class {
	storage;
	frameSizeLimit;
	lastTimestampIn;
	lastTimestampOut;
	constructor(storage, frameSizeLimit = 6e4) {
		if (frameSizeLimit < 4096) throw Error("frameSizeLimit too small");
		this.storage = storage;
		this.frameSizeLimit = frameSizeLimit;
		this.lastTimestampIn = 0;
		this.lastTimestampOut = 0;
	}
	_bound(timestamp, id) {
		return {
			timestamp,
			id: id || new Uint8Array(0)
		};
	}
	initiate() {
		let output = new WrappedBuffer();
		output.extend(new Uint8Array([PROTOCOL_VERSION$1]));
		this.splitRange(0, this.storage.size(), this._bound(Number.MAX_VALUE), output);
		return bytesToHex$2(output.unwrap());
	}
	reconcile(queryMsg, onhave, onneed) {
		const query = new WrappedBuffer(hexToBytes$2(queryMsg));
		this.lastTimestampIn = this.lastTimestampOut = 0;
		let fullOutput = new WrappedBuffer();
		fullOutput.extend(new Uint8Array([PROTOCOL_VERSION$1]));
		let protocolVersion = getByte(query);
		if (protocolVersion < 96 || protocolVersion > 111) throw Error("invalid negentropy protocol version byte");
		if (protocolVersion !== PROTOCOL_VERSION$1) throw Error("unsupported negentropy protocol version requested: " + (protocolVersion - 96));
		let storageSize = this.storage.size();
		let prevBound = this._bound(0);
		let prevIndex = 0;
		let skip = false;
		while (query.length !== 0) {
			let o = new WrappedBuffer();
			let doSkip = () => {
				if (skip) {
					skip = false;
					o.extend(this.encodeBound(prevBound));
					o.extend(encodeVarInt(Mode.Skip));
				}
			};
			let currBound = this.decodeBound(query);
			let mode = decodeVarInt(query);
			let lower = prevIndex;
			let upper = this.storage.findLowerBound(prevIndex, storageSize, currBound);
			if (mode === Mode.Skip) skip = true;
			else if (mode === Mode.Fingerprint) if (compareUint8Array(getBytes(query, FINGERPRINT_SIZE), this.storage.fingerprint(lower, upper)) !== 0) {
				doSkip();
				this.splitRange(lower, upper, currBound, o);
			} else skip = true;
			else if (mode === Mode.IdList) {
				let numIds = decodeVarInt(query);
				let theirElems = {};
				for (let i2 = 0; i2 < numIds; i2++) {
					let e = getBytes(query, ID_SIZE);
					theirElems[bytesToHex$2(e)] = e;
				}
				skip = true;
				this.storage.iterate(lower, upper, (item) => {
					let k = item.id;
					const id = bytesToHex$2(k);
					if (!theirElems[id]) onhave?.(id);
					else delete theirElems[bytesToHex$2(k)];
					return true;
				});
				if (onneed) for (let v of Object.values(theirElems)) onneed(bytesToHex$2(v));
			} else throw Error("unexpected mode");
			if (this.exceededFrameSizeLimit(fullOutput.length + o.length)) {
				let remainingFingerprint = this.storage.fingerprint(upper, storageSize);
				fullOutput.extend(this.encodeBound(this._bound(Number.MAX_VALUE)));
				fullOutput.extend(encodeVarInt(Mode.Fingerprint));
				fullOutput.extend(remainingFingerprint);
				break;
			} else fullOutput.extend(o);
			prevIndex = upper;
			prevBound = currBound;
		}
		return fullOutput.length === 1 ? null : bytesToHex$2(fullOutput.unwrap());
	}
	splitRange(lower, upper, upperBound, o) {
		let numElems = upper - lower;
		let buckets = 16;
		if (numElems < buckets * 2) {
			o.extend(this.encodeBound(upperBound));
			o.extend(encodeVarInt(Mode.IdList));
			o.extend(encodeVarInt(numElems));
			this.storage.iterate(lower, upper, (item) => {
				o.extend(item.id);
				return true;
			});
		} else {
			let itemsPerBucket = Math.floor(numElems / buckets);
			let bucketsWithExtra = numElems % buckets;
			let curr = lower;
			for (let i2 = 0; i2 < buckets; i2++) {
				let bucketSize = itemsPerBucket + (i2 < bucketsWithExtra ? 1 : 0);
				let ourFingerprint = this.storage.fingerprint(curr, curr + bucketSize);
				curr += bucketSize;
				let nextBound;
				if (curr === upper) nextBound = upperBound;
				else {
					let prevItem;
					let currItem;
					this.storage.iterate(curr - 1, curr + 1, (item, index) => {
						if (index === curr - 1) prevItem = item;
						else currItem = item;
						return true;
					});
					nextBound = this.getMinimalBound(prevItem, currItem);
				}
				o.extend(this.encodeBound(nextBound));
				o.extend(encodeVarInt(Mode.Fingerprint));
				o.extend(ourFingerprint);
			}
		}
	}
	exceededFrameSizeLimit(n) {
		return n > this.frameSizeLimit - 200;
	}
	decodeTimestampIn(encoded) {
		let timestamp = decodeVarInt(encoded);
		timestamp = timestamp === 0 ? Number.MAX_VALUE : timestamp - 1;
		if (this.lastTimestampIn === Number.MAX_VALUE || timestamp === Number.MAX_VALUE) {
			this.lastTimestampIn = Number.MAX_VALUE;
			return Number.MAX_VALUE;
		}
		timestamp += this.lastTimestampIn;
		this.lastTimestampIn = timestamp;
		return timestamp;
	}
	decodeBound(encoded) {
		let timestamp = this.decodeTimestampIn(encoded);
		let len = decodeVarInt(encoded);
		if (len > ID_SIZE) throw Error("bound key too long");
		return {
			timestamp,
			id: getBytes(encoded, len)
		};
	}
	encodeTimestampOut(timestamp) {
		if (timestamp === Number.MAX_VALUE) {
			this.lastTimestampOut = Number.MAX_VALUE;
			return encodeVarInt(0);
		}
		let temp = timestamp;
		timestamp -= this.lastTimestampOut;
		this.lastTimestampOut = temp;
		return encodeVarInt(timestamp + 1);
	}
	encodeBound(key) {
		let output = new WrappedBuffer();
		output.extend(this.encodeTimestampOut(key.timestamp));
		output.extend(encodeVarInt(key.id.length));
		output.extend(key.id);
		return output;
	}
	getMinimalBound(prev, curr) {
		if (curr.timestamp !== prev.timestamp) return this._bound(curr.timestamp);
		else {
			let sharedPrefixBytes = 0;
			let currKey = curr.id;
			let prevKey = prev.id;
			for (let i2 = 0; i2 < ID_SIZE; i2++) {
				if (currKey[i2] !== prevKey[i2]) break;
				sharedPrefixBytes++;
			}
			return this._bound(curr.timestamp, curr.id.subarray(0, sharedPrefixBytes + 1));
		}
	}
};
function compareUint8Array(a, b) {
	for (let i2 = 0; i2 < a.byteLength; i2++) {
		if (a[i2] < b[i2]) return -1;
		if (a[i2] > b[i2]) return 1;
	}
	if (a.byteLength > b.byteLength) return 1;
	if (a.byteLength < b.byteLength) return -1;
	return 0;
}
function itemCompare(a, b) {
	if (a.timestamp === b.timestamp) return compareUint8Array(a.id, b.id);
	return a.timestamp - b.timestamp;
}
var NegentropySync = class {
	relay;
	storage;
	neg;
	filter;
	subscription;
	onhave;
	onneed;
	constructor(relay, storage, filter, params = {}) {
		this.relay = relay;
		this.storage = storage;
		this.neg = new Negentropy(storage);
		this.onhave = params.onhave;
		this.onneed = params.onneed;
		this.filter = filter;
		this.subscription = this.relay.prepareSubscription([{}], { label: params.label || "negentropy" });
		this.subscription.oncustom = (data) => {
			switch (data[0]) {
				case "NEG-MSG":
					if (data.length < 3) console.warn(`got invalid NEG-MSG from ${this.relay.url}: ${data}`);
					try {
						const response = this.neg.reconcile(data[2], this.onhave, this.onneed);
						if (response) this.relay.send(`["NEG-MSG", "${this.subscription.id}", "${response}"]`);
						else {
							this.close();
							params.onclose?.();
						}
					} catch (error) {
						console.error("negentropy reconcile error:", error);
						params?.onclose?.(`reconcile error: ${error}`);
					}
					break;
				case "NEG-CLOSE": {
					const reason = data[2];
					console.warn("negentropy error:", reason);
					params.onclose?.(reason);
					break;
				}
				case "NEG-ERR": params.onclose?.();
			}
		};
	}
	async start() {
		const initMsg = this.neg.initiate();
		this.relay.send(`["NEG-OPEN","${this.subscription.id}",${JSON.stringify(this.filter)},"${initMsg}"]`);
	}
	close() {
		this.relay.send(`["NEG-CLOSE","${this.subscription.id}"]`);
		this.subscription.close();
	}
};
__export({}, {
	getToken: () => getToken,
	hashPayload: () => hashPayload,
	unpackEventFromToken: () => unpackEventFromToken,
	validateEvent: () => validateEvent2,
	validateEventKind: () => validateEventKind,
	validateEventMethodTag: () => validateEventMethodTag,
	validateEventPayloadTag: () => validateEventPayloadTag,
	validateEventTimestamp: () => validateEventTimestamp,
	validateEventUrlTag: () => validateEventUrlTag,
	validateToken: () => validateToken
});
var _authorizationScheme = "Nostr ";
async function getToken(loginUrl, httpMethod, sign, includeAuthorizationScheme = false, payload) {
	const event = {
		kind: HTTPAuth,
		tags: [["u", loginUrl], ["method", httpMethod]],
		created_at: Math.round((/* @__PURE__ */ new Date()).getTime() / 1e3),
		content: ""
	};
	if (payload) event.tags.push(["payload", hashPayload(payload)]);
	const signedEvent = await sign(event);
	return (includeAuthorizationScheme ? _authorizationScheme : "") + base64$1.encode(utf8Encoder.encode(JSON.stringify(signedEvent)));
}
async function validateToken(token, url, method) {
	return await validateEvent2(await unpackEventFromToken(token).catch((error) => {
		throw error;
	}), url, method).catch((error) => {
		throw error;
	});
}
async function unpackEventFromToken(token) {
	if (!token) throw new Error("Missing token");
	token = token.replace(_authorizationScheme, "");
	const eventB64 = utf8Decoder.decode(base64$1.decode(token));
	if (!eventB64 || eventB64.length === 0 || !eventB64.startsWith("{")) throw new Error("Invalid token");
	return JSON.parse(eventB64);
}
function validateEventTimestamp(event) {
	if (!event.created_at) return false;
	return Math.round((/* @__PURE__ */ new Date()).getTime() / 1e3) - event.created_at < 60;
}
function validateEventKind(event) {
	return event.kind === HTTPAuth;
}
function validateEventUrlTag(event, url) {
	const urlTag = event.tags.find((t) => t[0] === "u");
	if (!urlTag) return false;
	return urlTag.length > 0 && urlTag[1] === url;
}
function validateEventMethodTag(event, method) {
	const methodTag = event.tags.find((t) => t[0] === "method");
	if (!methodTag) return false;
	return methodTag.length > 0 && methodTag[1].toLowerCase() === method.toLowerCase();
}
function hashPayload(payload) {
	return bytesToHex$2(sha256$1(utf8Encoder.encode(JSON.stringify(payload))));
}
function validateEventPayloadTag(event, payload) {
	const payloadTag = event.tags.find((t) => t[0] === "payload");
	if (!payloadTag) return false;
	const payloadHash = hashPayload(payload);
	return payloadTag.length > 0 && payloadTag[1] === payloadHash;
}
async function validateEvent2(event, url, method, body) {
	if (!verifyEvent(event)) throw new Error("Invalid nostr event, signature invalid");
	if (!validateEventKind(event)) throw new Error("Invalid nostr event, kind invalid");
	if (!validateEventTimestamp(event)) throw new Error("Invalid nostr event, created_at timestamp invalid");
	if (!validateEventUrlTag(event, url)) throw new Error("Invalid nostr event, url tag invalid");
	if (!validateEventMethodTag(event, method)) throw new Error("Invalid nostr event, method tag invalid");
	if (Boolean(body) && typeof body === "object" && Object.keys(body).length > 0) {
		if (!validateEventPayloadTag(event, body)) throw new Error("Invalid nostr event, payload tag does not match request body hash");
	}
	return true;
}
//#endregion
//#region node_modules/zod/v4/core/core.js
var _a$1;
/** A special constant with type `never` */
const NEVER = /*@__PURE__*/ Object.freeze({ status: "aborted" });
function $constructor(name, initializer, params) {
	function init(inst, def) {
		if (!inst._zod) Object.defineProperty(inst, "_zod", {
			value: {
				def,
				constr: _,
				traits: /* @__PURE__ */ new Set()
			},
			enumerable: false
		});
		if (inst._zod.traits.has(name)) return;
		inst._zod.traits.add(name);
		initializer(inst, def);
		const proto = _.prototype;
		const keys = Object.keys(proto);
		for (let i = 0; i < keys.length; i++) {
			const k = keys[i];
			if (!(k in inst)) inst[k] = proto[k].bind(inst);
		}
	}
	const Parent = params?.Parent ?? Object;
	class Definition extends Parent {}
	Object.defineProperty(Definition, "name", { value: name });
	function _(def) {
		var _a;
		const inst = params?.Parent ? new Definition() : this;
		init(inst, def);
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		for (const fn of inst._zod.deferred) fn();
		return inst;
	}
	Object.defineProperty(_, "init", { value: init });
	Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
		if (params?.Parent && inst instanceof params.Parent) return true;
		return inst?._zod?.traits?.has(name);
	} });
	Object.defineProperty(_, "name", { value: name });
	return _;
}
var $ZodAsyncError = class extends Error {
	constructor() {
		super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
	}
};
var $ZodEncodeError = class extends Error {
	constructor(name) {
		super(`Encountered unidirectional transform during encode: ${name}`);
		this.name = "ZodEncodeError";
	}
};
(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
const globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
	if (newConfig) Object.assign(globalConfig, newConfig);
	return globalConfig;
}
//#endregion
//#region node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
	const numericValues = Object.values(entries).filter((v) => typeof v === "number");
	return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
}
function jsonStringifyReplacer(_, value) {
	if (typeof value === "bigint") return value.toString();
	return value;
}
function cached(getter) {
	return { get value() {
		{
			const value = getter();
			Object.defineProperty(this, "value", { value });
			return value;
		}
		throw new Error("cached value already set");
	} };
}
function nullish(input) {
	return input === null || input === void 0;
}
function cleanRegex(source) {
	const start = source.startsWith("^") ? 1 : 0;
	const end = source.endsWith("$") ? source.length - 1 : source.length;
	return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
	const ratio = val / step;
	const roundedRatio = Math.round(ratio);
	const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
	if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
	return ratio - roundedRatio;
}
const EVALUATING = /* @__PURE__*/ Symbol("evaluating");
function defineLazy(object, key, getter) {
	let value = void 0;
	Object.defineProperty(object, key, {
		get() {
			if (value === EVALUATING) return;
			if (value === void 0) {
				value = EVALUATING;
				value = getter();
			}
			return value;
		},
		set(v) {
			Object.defineProperty(object, key, { value: v });
		},
		configurable: true
	});
}
function assignProp(target, prop, value) {
	Object.defineProperty(target, prop, {
		value,
		writable: true,
		enumerable: true,
		configurable: true
	});
}
function mergeDefs(...defs) {
	const mergedDescriptors = {};
	for (const def of defs) Object.assign(mergedDescriptors, Object.getOwnPropertyDescriptors(def));
	return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
	return JSON.stringify(str);
}
function slugify(input) {
	return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject(data) {
	return typeof data === "object" && data !== null && !Array.isArray(data);
}
const allowsEval = /* @__PURE__*/ cached(() => {
	if (globalConfig.jitless) return false;
	if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
	try {
		new Function("");
		return true;
	} catch (_) {
		return false;
	}
});
function isPlainObject(o) {
	if (isObject(o) === false) return false;
	const ctor = o.constructor;
	if (ctor === void 0) return true;
	if (typeof ctor !== "function") return true;
	const prot = ctor.prototype;
	if (isObject(prot) === false) return false;
	if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
	return true;
}
function shallowClone(o) {
	if (isPlainObject(o)) return { ...o };
	if (Array.isArray(o)) return [...o];
	if (o instanceof Map) return new Map(o);
	if (o instanceof Set) return new Set(o);
	return o;
}
const propertyKeyTypes = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
	const cl = new inst._zod.constr(def ?? inst._zod.def);
	if (!def || params?.parent) cl._zod.parent = inst;
	return cl;
}
function normalizeParams(_params) {
	const params = _params;
	if (!params) return {};
	if (typeof params === "string") return { error: () => params };
	if (params?.message !== void 0) {
		if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
		params.error = params.message;
	}
	delete params.message;
	if (typeof params.error === "string") return {
		...params,
		error: () => params.error
	};
	return params;
}
function optionalKeys(shape) {
	return Object.keys(shape).filter((k) => {
		return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
	});
}
const NUMBER_FORMAT_RANGES = {
	safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function pick(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = {};
			for (const key in mask) {
				if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				newShape[key] = currDef.shape[key];
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function omit(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = { ...schema._zod.def.shape };
			for (const key in mask) {
				if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				delete newShape[key];
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function extend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to extend: expected a plain object");
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) {
		const existingShape = schema._zod.def.shape;
		for (const key in shape) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function safeExtend(schema, shape) {
	if (!isPlainObject(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function merge(a, b) {
	if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	return clone(a, mergeDefs(a._zod.def, {
		get shape() {
			const _shape = {
				...a._zod.def.shape,
				...b._zod.def.shape
			};
			assignProp(this, "shape", _shape);
			return _shape;
		},
		get catchall() {
			return b._zod.def.catchall;
		},
		checks: b._zod.def.checks ?? []
	}));
}
function partial(Class, schema, mask) {
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) throw new Error(".partial() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const oldShape = schema._zod.def.shape;
			const shape = { ...oldShape };
			if (mask) for (const key in mask) {
				if (!(key in oldShape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				shape[key] = Class ? new Class({
					type: "optional",
					innerType: oldShape[key]
				}) : oldShape[key];
			}
			else for (const key in oldShape) shape[key] = Class ? new Class({
				type: "optional",
				innerType: oldShape[key]
			}) : oldShape[key];
			assignProp(this, "shape", shape);
			return shape;
		},
		checks: []
	}));
}
function required(Class, schema, mask) {
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const oldShape = schema._zod.def.shape;
		const shape = { ...oldShape };
		if (mask) for (const key in mask) {
			if (!(key in shape)) throw new Error(`Unrecognized key: "${key}"`);
			if (!mask[key]) continue;
			shape[key] = new Class({
				type: "nonoptional",
				innerType: oldShape[key]
			});
		}
		else for (const key in oldShape) shape[key] = new Class({
			type: "nonoptional",
			innerType: oldShape[key]
		});
		assignProp(this, "shape", shape);
		return shape;
	} }));
}
function aborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
	return false;
}
function explicitlyAborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
	return false;
}
function prefixIssues(path, issues) {
	return issues.map((iss) => {
		var _a;
		(_a = iss).path ?? (_a.path = []);
		iss.path.unshift(path);
		return iss;
	});
}
function unwrapMessage(message) {
	return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config) {
	const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
	const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
	rest.path ?? (rest.path = []);
	rest.message = message;
	if (ctx?.reportInput) rest.input = _input;
	return rest;
}
function getLengthableOrigin(input) {
	if (Array.isArray(input)) return "array";
	if (typeof input === "string") return "string";
	return "unknown";
}
function issue(...args) {
	const [iss, input, inst] = args;
	if (typeof iss === "string") return {
		message: iss,
		code: "custom",
		input,
		inst
	};
	return { ...iss };
}
//#endregion
//#region node_modules/zod/v4/core/errors.js
const initializer$1 = (inst, def) => {
	inst.name = "$ZodError";
	Object.defineProperty(inst, "_zod", {
		value: inst._zod,
		enumerable: false
	});
	Object.defineProperty(inst, "issues", {
		value: def,
		enumerable: false
	});
	inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
	Object.defineProperty(inst, "toString", {
		value: () => inst.message,
		enumerable: false
	});
};
const $ZodError = $constructor("$ZodError", initializer$1);
const $ZodRealError = $constructor("$ZodError", initializer$1, { Parent: Error });
function flattenError(error, mapper = (issue) => issue.message) {
	const fieldErrors = {};
	const formErrors = [];
	for (const sub of error.issues) if (sub.path.length > 0) {
		fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
		fieldErrors[sub.path[0]].push(mapper(sub));
	} else formErrors.push(mapper(sub));
	return {
		formErrors,
		fieldErrors
	};
}
function formatError(error, mapper = (issue) => issue.message) {
	const fieldErrors = { _errors: [] };
	const processError = (error, path = []) => {
		for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
		else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else {
			const fullpath = [...path, ...issue.path];
			if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
			else {
				let curr = fieldErrors;
				let i = 0;
				while (i < fullpath.length) {
					const el = fullpath[i];
					if (!(i === fullpath.length - 1)) curr[el] = curr[el] || { _errors: [] };
					else {
						curr[el] = curr[el] || { _errors: [] };
						curr[el]._errors.push(mapper(issue));
					}
					curr = curr[el];
					i++;
				}
			}
		}
	};
	processError(error);
	return fieldErrors;
}
//#endregion
//#region node_modules/zod/v4/core/parse.js
const _parse = (_Err) => (schema, value, _ctx, _params) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	if (result.issues.length) {
		const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
		captureStackTrace(e, _params?.callee);
		throw e;
	}
	return result.value;
};
const _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	if (result.issues.length) {
		const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
		captureStackTrace(e, params?.callee);
		throw e;
	}
	return result.value;
};
const _safeParse = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	return result.issues.length ? {
		success: false,
		error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
const safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	return result.issues.length ? {
		success: false,
		error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
const safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
const _encode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _parse(_Err)(schema, value, ctx);
};
const _decode = (_Err) => (schema, value, _ctx) => {
	return _parse(_Err)(schema, value, _ctx);
};
const _encodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _parseAsync(_Err)(schema, value, ctx);
};
const _decodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _parseAsync(_Err)(schema, value, _ctx);
};
const _safeEncode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParse(_Err)(schema, value, ctx);
};
const _safeDecode = (_Err) => (schema, value, _ctx) => {
	return _safeParse(_Err)(schema, value, _ctx);
};
const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParseAsync(_Err)(schema, value, ctx);
};
const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _safeParseAsync(_Err)(schema, value, _ctx);
};
//#endregion
//#region node_modules/zod/v4/core/regexes.js
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const cuid = /^[cC][0-9a-z]{6,}$/;
const cuid2 = /^[0-9a-z]+$/;
const ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
const xid = /^[0-9a-vA-V]{20}$/;
const ksuid = /^[A-Za-z0-9]{27}$/;
const nanoid = /^[a-zA-Z0-9_-]{21}$/;
/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
const duration$1 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
/** Returns a regex for validating an RFC 9562/4122 UUID.
*
* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
const uuid = (version) => {
	if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
	return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
/** Practical email validation */
const email$1 = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
const _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
	return new RegExp(_emoji$1, "u");
}
const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
const base64url = /^[A-Za-z0-9_-]*$/;
const httpProtocol = /^https?$/;
const e164 = /^\+[1-9]\d{6,14}$/;
const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
const date$1 = /*@__PURE__*/ new RegExp(`^${dateSource}$`);
function timeSource(args) {
	const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
	return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function time$1(args) {
	return new RegExp(`^${timeSource(args)}$`);
}
function datetime$1(args) {
	const time = timeSource({ precision: args.precision });
	const opts = ["Z"];
	if (args.local) opts.push("");
	if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
	const timeRegex = `${time}(?:${opts.join("|")})`;
	return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
const string$1 = (params) => {
	const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
	return new RegExp(`^${regex}$`);
};
const integer = /^-?\d+$/;
const number$1 = /^-?\d+(?:\.\d+)?$/;
const boolean$1 = /^(?:true|false)$/i;
const lowercase = /^[^A-Z]*$/;
const uppercase = /^[^a-z]*$/;
//#endregion
//#region node_modules/zod/v4/core/checks.js
const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
	var _a;
	inst._zod ?? (inst._zod = {});
	inst._zod.def = def;
	(_a = inst._zod).onattach ?? (_a.onattach = []);
});
const numericOriginMap = {
	number: "number",
	bigint: "bigint",
	object: "date"
};
const $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
		if (def.value < curr) if (def.inclusive) bag.maximum = def.value;
		else bag.exclusiveMaximum = def.value;
	});
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
		if (def.value > curr) if (def.inclusive) bag.minimum = def.value;
		else bag.exclusiveMinimum = def.value;
	});
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.onattach.push((inst) => {
		var _a;
		(_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
	});
	inst._zod.check = (payload) => {
		if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
		if (typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
		payload.issues.push({
			origin: typeof payload.value,
			code: "not_multiple_of",
			divisor: def.value,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
	$ZodCheck.init(inst, def);
	def.format = def.format || "float64";
	const isInt = def.format?.includes("int");
	const origin = isInt ? "int" : "number";
	const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.format = def.format;
		bag.minimum = minimum;
		bag.maximum = maximum;
		if (isInt) bag.pattern = integer;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (isInt) {
			if (!Number.isInteger(input)) {
				payload.issues.push({
					expected: origin,
					format: def.format,
					code: "invalid_type",
					continue: false,
					input,
					inst
				});
				return;
			}
			if (!Number.isSafeInteger(input)) {
				if (input > 0) payload.issues.push({
					input,
					code: "too_big",
					maximum: Number.MAX_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				else payload.issues.push({
					input,
					code: "too_small",
					minimum: Number.MIN_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				return;
			}
		}
		if (input < minimum) payload.issues.push({
			origin: "number",
			input,
			code: "too_small",
			minimum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
		if (input > maximum) payload.issues.push({
			origin: "number",
			input,
			code: "too_big",
			maximum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
		if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (input.length <= def.maximum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: def.maximum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
		if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (input.length >= def.minimum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: def.minimum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.minimum = def.length;
		bag.maximum = def.length;
		bag.length = def.length;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		const length = input.length;
		if (length === def.length) return;
		const origin = getLengthableOrigin(input);
		const tooBig = length > def.length;
		payload.issues.push({
			origin,
			...tooBig ? {
				code: "too_big",
				maximum: def.length
			} : {
				code: "too_small",
				minimum: def.length
			},
			inclusive: true,
			exact: true,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
	var _a, _b;
	$ZodCheck.init(inst, def);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.format = def.format;
		if (def.pattern) {
			bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
			bag.patterns.add(def.pattern);
		}
	});
	if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: def.format,
			input: payload.value,
			...def.pattern ? { pattern: def.pattern.toString() } : {},
			inst,
			continue: !def.abort
		});
	});
	else (_b = inst._zod).check ?? (_b.check = () => {});
});
const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: payload.value,
			pattern: def.pattern.toString(),
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
	def.pattern ?? (def.pattern = lowercase);
	$ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
	def.pattern ?? (def.pattern = uppercase);
	$ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
	$ZodCheck.init(inst, def);
	const escapedRegex = escapeRegex(def.includes);
	const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
	def.pattern = pattern;
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.includes(def.includes, def.position)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: def.includes,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.startsWith(def.prefix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: def.prefix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.endsWith(def.suffix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: def.suffix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.check = (payload) => {
		payload.value = def.tx(payload.value);
	};
});
//#endregion
//#region node_modules/zod/v4/core/doc.js
var Doc = class {
	constructor(args = []) {
		this.content = [];
		this.indent = 0;
		if (this) this.args = args;
	}
	indented(fn) {
		this.indent += 1;
		fn(this);
		this.indent -= 1;
	}
	write(arg) {
		if (typeof arg === "function") {
			arg(this, { execution: "sync" });
			arg(this, { execution: "async" });
			return;
		}
		const lines = arg.split("\n").filter((x) => x);
		const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
		const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
		for (const line of dedented) this.content.push(line);
	}
	compile() {
		const F = Function;
		const args = this?.args;
		const lines = [...(this?.content ?? [``]).map((x) => `  ${x}`)];
		return new F(...args, lines.join("\n"));
	}
};
//#endregion
//#region node_modules/zod/v4/core/versions.js
const version = {
	major: 4,
	minor: 4,
	patch: 3
};
//#endregion
//#region node_modules/zod/v4/core/schemas.js
const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
	var _a;
	inst ?? (inst = {});
	inst._zod.def = def;
	inst._zod.bag = inst._zod.bag || {};
	inst._zod.version = version;
	const checks = [...inst._zod.def.checks ?? []];
	if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
	for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
	if (checks.length === 0) {
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred?.push(() => {
			inst._zod.run = inst._zod.parse;
		});
	} else {
		const runChecks = (payload, checks, ctx) => {
			let isAborted = aborted(payload);
			let asyncResult;
			for (const ch of checks) {
				if (ch._zod.def.when) {
					if (explicitlyAborted(payload)) continue;
					if (!ch._zod.def.when(payload)) continue;
				} else if (isAborted) continue;
				const currLen = payload.issues.length;
				const _ = ch._zod.check(payload);
				if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
				if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
					await _;
					if (payload.issues.length === currLen) return;
					if (!isAborted) isAborted = aborted(payload, currLen);
				});
				else {
					if (payload.issues.length === currLen) continue;
					if (!isAborted) isAborted = aborted(payload, currLen);
				}
			}
			if (asyncResult) return asyncResult.then(() => {
				return payload;
			});
			return payload;
		};
		const handleCanaryResult = (canary, payload, ctx) => {
			if (aborted(canary)) {
				canary.aborted = true;
				return canary;
			}
			const checkResult = runChecks(payload, checks, ctx);
			if (checkResult instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
			}
			return inst._zod.parse(checkResult, ctx);
		};
		inst._zod.run = (payload, ctx) => {
			if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
			if (ctx.direction === "backward") {
				const canary = inst._zod.parse({
					value: payload.value,
					issues: []
				}, {
					...ctx,
					skipChecks: true
				});
				if (canary instanceof Promise) return canary.then((canary) => {
					return handleCanaryResult(canary, payload, ctx);
				});
				return handleCanaryResult(canary, payload, ctx);
			}
			const result = inst._zod.parse(payload, ctx);
			if (result instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return result.then((result) => runChecks(result, checks, ctx));
			}
			return runChecks(result, checks, ctx);
		};
	}
	defineLazy(inst, "~standard", () => ({
		validate: (value) => {
			try {
				const r = safeParse$1(inst, value);
				return r.success ? { value: r.data } : { issues: r.error?.issues };
			} catch (_) {
				return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
			}
		},
		vendor: "zod",
		version: 1
	}));
});
const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
	inst._zod.parse = (payload, _) => {
		if (def.coerce) try {
			payload.value = String(payload.value);
		} catch (_) {}
		if (typeof payload.value === "string") return payload;
		payload.issues.push({
			expected: "string",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	$ZodString.init(inst, def);
});
const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
	def.pattern ?? (def.pattern = guid);
	$ZodStringFormat.init(inst, def);
});
const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
	if (def.version) {
		const v = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[def.version];
		if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
		def.pattern ?? (def.pattern = uuid(v));
	} else def.pattern ?? (def.pattern = uuid());
	$ZodStringFormat.init(inst, def);
});
const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
	def.pattern ?? (def.pattern = email$1);
	$ZodStringFormat.init(inst, def);
});
const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		try {
			const trimmed = payload.value.trim();
			if (!def.normalize && def.protocol?.source === httpProtocol.source) {
				if (!/^https?:\/\//i.test(trimmed)) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						note: "Invalid URL format",
						input: payload.value,
						inst,
						continue: !def.abort
					});
					return;
				}
			}
			const url = new URL(trimmed);
			if (def.hostname) {
				def.hostname.lastIndex = 0;
				if (!def.hostname.test(url.hostname)) payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid hostname",
					pattern: def.hostname.source,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
			if (def.protocol) {
				def.protocol.lastIndex = 0;
				if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid protocol",
					pattern: def.protocol.source,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
			if (def.normalize) payload.value = url.href;
			else payload.value = trimmed;
			return;
		} catch (_) {
			payload.issues.push({
				code: "invalid_format",
				format: "url",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
	def.pattern ?? (def.pattern = emoji());
	$ZodStringFormat.init(inst, def);
});
const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
	def.pattern ?? (def.pattern = nanoid);
	$ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
	def.pattern ?? (def.pattern = cuid);
	$ZodStringFormat.init(inst, def);
});
const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
	def.pattern ?? (def.pattern = cuid2);
	$ZodStringFormat.init(inst, def);
});
const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
	def.pattern ?? (def.pattern = ulid);
	$ZodStringFormat.init(inst, def);
});
const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
	def.pattern ?? (def.pattern = xid);
	$ZodStringFormat.init(inst, def);
});
const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
	def.pattern ?? (def.pattern = ksuid);
	$ZodStringFormat.init(inst, def);
});
const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
	def.pattern ?? (def.pattern = datetime$1(def));
	$ZodStringFormat.init(inst, def);
});
const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
	def.pattern ?? (def.pattern = date$1);
	$ZodStringFormat.init(inst, def);
});
const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
	def.pattern ?? (def.pattern = time$1(def));
	$ZodStringFormat.init(inst, def);
});
const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
	def.pattern ?? (def.pattern = duration$1);
	$ZodStringFormat.init(inst, def);
});
const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
	def.pattern ?? (def.pattern = ipv4);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv4`;
});
const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
	def.pattern ?? (def.pattern = ipv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv6`;
	inst._zod.check = (payload) => {
		try {
			new URL(`http://[${payload.value}]`);
		} catch {
			payload.issues.push({
				code: "invalid_format",
				format: "ipv6",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv4);
	$ZodStringFormat.init(inst, def);
});
const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		const parts = payload.value.split("/");
		try {
			if (parts.length !== 2) throw new Error();
			const [address, prefix] = parts;
			if (!prefix) throw new Error();
			const prefixNum = Number(prefix);
			if (`${prefixNum}` !== prefix) throw new Error();
			if (prefixNum < 0 || prefixNum > 128) throw new Error();
			new URL(`http://[${address}]`);
		} catch {
			payload.issues.push({
				code: "invalid_format",
				format: "cidrv6",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
function isValidBase64(data) {
	if (data === "") return true;
	if (/\s/.test(data)) return false;
	if (data.length % 4 !== 0) return false;
	try {
		atob(data);
		return true;
	} catch {
		return false;
	}
}
const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
	def.pattern ?? (def.pattern = base64);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64";
	inst._zod.check = (payload) => {
		if (isValidBase64(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
function isValidBase64URL(data) {
	if (!base64url.test(data)) return false;
	const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
	return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}
const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
	def.pattern ?? (def.pattern = base64url);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64url";
	inst._zod.check = (payload) => {
		if (isValidBase64URL(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
	def.pattern ?? (def.pattern = e164);
	$ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
	try {
		const tokensParts = token.split(".");
		if (tokensParts.length !== 3) return false;
		const [header] = tokensParts;
		if (!header) return false;
		const parsedHeader = JSON.parse(atob(header));
		if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
		if (!parsedHeader.alg) return false;
		if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
		return true;
	} catch {
		return false;
	}
}
const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidJWT(payload.value, def.alg)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = inst._zod.bag.pattern ?? number$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Number(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
		const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
		payload.issues.push({
			expected: "number",
			code: "invalid_type",
			input,
			inst,
			...received ? { received } : {}
		});
		return payload;
	};
});
const $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
	$ZodCheckNumberFormat.init(inst, def);
	$ZodNumber.init(inst, def);
});
const $ZodBoolean = /*@__PURE__*/ $constructor("$ZodBoolean", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = boolean$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Boolean(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "boolean") return payload;
		payload.issues.push({
			expected: "boolean",
			code: "invalid_type",
			input,
			inst
		});
		return payload;
	};
});
const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload) => payload;
});
const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _ctx) => {
		payload.issues.push({
			expected: "never",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
function handleArrayResult(result, final, index) {
	if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
	final.value[index] = result.value;
}
const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!Array.isArray(input)) {
			payload.issues.push({
				expected: "array",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = Array(input.length);
		const proms = [];
		for (let i = 0; i < input.length; i++) {
			const item = input[i];
			const result = def.element._zod.run({
				value: item,
				issues: []
			}, ctx);
			if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
			else handleArrayResult(result, payload, i);
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
	const isPresent = key in input;
	if (result.issues.length) {
		if (isOptionalIn && isOptionalOut && !isPresent) return;
		final.issues.push(...prefixIssues(key, result.issues));
	}
	if (!isPresent && !isOptionalIn) {
		if (!result.issues.length) final.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [key]
		});
		return;
	}
	if (result.value === void 0) {
		if (isPresent) final.value[key] = void 0;
	} else final.value[key] = result.value;
}
function normalizeDef(def) {
	const keys = Object.keys(def.shape);
	for (const k of keys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
	const okeys = optionalKeys(def.shape);
	return {
		...def,
		keys,
		keySet: new Set(keys),
		numKeys: keys.length,
		optionalKeys: new Set(okeys)
	};
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
	const unrecognized = [];
	const keySet = def.keySet;
	const _catchall = def.catchall._zod;
	const t = _catchall.def.type;
	const isOptionalIn = _catchall.optin === "optional";
	const isOptionalOut = _catchall.optout === "optional";
	for (const key in input) {
		if (key === "__proto__") continue;
		if (keySet.has(key)) continue;
		if (t === "never") {
			unrecognized.push(key);
			continue;
		}
		const r = _catchall.run({
			value: input[key],
			issues: []
		}, ctx);
		if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
		else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
	}
	if (unrecognized.length) payload.issues.push({
		code: "unrecognized_keys",
		keys: unrecognized,
		input,
		inst
	});
	if (!proms.length) return payload;
	return Promise.all(proms).then(() => {
		return payload;
	});
}
const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
	$ZodType.init(inst, def);
	if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
		const sh = def.shape;
		Object.defineProperty(def, "shape", { get: () => {
			const newSh = { ...sh };
			Object.defineProperty(def, "shape", { value: newSh });
			return newSh;
		} });
	}
	const _normalized = cached(() => normalizeDef(def));
	defineLazy(inst._zod, "propValues", () => {
		const shape = def.shape;
		const propValues = {};
		for (const key in shape) {
			const field = shape[key]._zod;
			if (field.values) {
				propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
				for (const v of field.values) propValues[key].add(v);
			}
		}
		return propValues;
	});
	const isObject$1 = isObject;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$1(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = {};
		const proms = [];
		const shape = value.shape;
		for (const key of value.keys) {
			const el = shape[key];
			const isOptionalIn = el._zod.optin === "optional";
			const isOptionalOut = el._zod.optout === "optional";
			const r = el._zod.run({
				value: input[key],
				issues: []
			}, ctx);
			if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
			else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
		}
		if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
		return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
	};
});
const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
	$ZodObject.init(inst, def);
	const superParse = inst._zod.parse;
	const _normalized = cached(() => normalizeDef(def));
	const generateFastpass = (shape) => {
		const doc = new Doc([
			"shape",
			"payload",
			"ctx"
		]);
		const normalized = _normalized.value;
		const parseStr = (key) => {
			const k = esc(key);
			return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
		};
		doc.write(`const input = payload.value;`);
		const ids = Object.create(null);
		let counter = 0;
		for (const key of normalized.keys) ids[key] = `key_${counter++}`;
		doc.write(`const newResult = {};`);
		for (const key of normalized.keys) {
			const id = ids[key];
			const k = esc(key);
			const schema = shape[key];
			const isOptionalIn = schema?._zod?.optin === "optional";
			const isOptionalOut = schema?._zod?.optout === "optional";
			doc.write(`const ${id} = ${parseStr(key)};`);
			if (isOptionalIn && isOptionalOut) doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }

        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }

      `);
			else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
			else doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }

        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }

      `);
		}
		doc.write(`payload.value = newResult;`);
		doc.write(`return payload;`);
		const fn = doc.compile();
		return (payload, ctx) => fn(shape, payload, ctx);
	};
	let fastpass;
	const isObject$2 = isObject;
	const jit = !globalConfig.jitless;
	const fastEnabled = jit && allowsEval.value;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject$2(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
			if (!fastpass) fastpass = generateFastpass(def.shape);
			payload = fastpass(payload, ctx);
			if (!catchall) return payload;
			return handleCatchall([], input, payload, ctx, value, inst);
		}
		return superParse(payload, ctx);
	};
});
function handleUnionResults(results, final, inst, ctx) {
	for (const result of results) if (result.issues.length === 0) {
		final.value = result.value;
		return final;
	}
	const nonaborted = results.filter((r) => !aborted(r));
	if (nonaborted.length === 1) {
		final.value = nonaborted[0].value;
		return nonaborted[0];
	}
	final.issues.push({
		code: "invalid_union",
		input: final.value,
		inst,
		errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	});
	return final;
}
const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
	defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
	defineLazy(inst._zod, "values", () => {
		if (def.options.every((o) => o._zod.values)) return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
	});
	defineLazy(inst._zod, "pattern", () => {
		if (def.options.every((o) => o._zod.pattern)) {
			const patterns = def.options.map((o) => o._zod.pattern);
			return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
		}
	});
	const first = def.options.length === 1 ? def.options[0]._zod.run : null;
	inst._zod.parse = (payload, ctx) => {
		if (first) return first(payload, ctx);
		let async = false;
		const results = [];
		for (const option of def.options) {
			const result = option._zod.run({
				value: payload.value,
				issues: []
			}, ctx);
			if (result instanceof Promise) {
				results.push(result);
				async = true;
			} else {
				if (result.issues.length === 0) return result;
				results.push(result);
			}
		}
		if (!async) return handleUnionResults(results, payload, inst, ctx);
		return Promise.all(results).then((results) => {
			return handleUnionResults(results, payload, inst, ctx);
		});
	};
});
const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		const left = def.left._zod.run({
			value: input,
			issues: []
		}, ctx);
		const right = def.right._zod.run({
			value: input,
			issues: []
		}, ctx);
		if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
			return handleIntersectionResults(payload, left, right);
		});
		return handleIntersectionResults(payload, left, right);
	};
});
function mergeValues(a, b) {
	if (a === b) return {
		valid: true,
		data: a
	};
	if (a instanceof Date && b instanceof Date && +a === +b) return {
		valid: true,
		data: a
	};
	if (isPlainObject(a) && isPlainObject(b)) {
		const bKeys = Object.keys(b);
		const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
		const newObj = {
			...a,
			...b
		};
		for (const key of sharedKeys) {
			const sharedValue = mergeValues(a[key], b[key]);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
			};
			newObj[key] = sharedValue.data;
		}
		return {
			valid: true,
			data: newObj
		};
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return {
			valid: false,
			mergeErrorPath: []
		};
		const newArray = [];
		for (let index = 0; index < a.length; index++) {
			const itemA = a[index];
			const itemB = b[index];
			const sharedValue = mergeValues(itemA, itemB);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
			};
			newArray.push(sharedValue.data);
		}
		return {
			valid: true,
			data: newArray
		};
	}
	return {
		valid: false,
		mergeErrorPath: []
	};
}
function handleIntersectionResults(result, left, right) {
	const unrecKeys = /* @__PURE__ */ new Map();
	let unrecIssue;
	for (const iss of left.issues) if (iss.code === "unrecognized_keys") {
		unrecIssue ?? (unrecIssue = iss);
		for (const k of iss.keys) {
			if (!unrecKeys.has(k)) unrecKeys.set(k, {});
			unrecKeys.get(k).l = true;
		}
	} else result.issues.push(iss);
	for (const iss of right.issues) if (iss.code === "unrecognized_keys") for (const k of iss.keys) {
		if (!unrecKeys.has(k)) unrecKeys.set(k, {});
		unrecKeys.get(k).r = true;
	}
	else result.issues.push(iss);
	const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
	if (bothKeys.length && unrecIssue) result.issues.push({
		...unrecIssue,
		keys: bothKeys
	});
	if (aborted(result)) return result;
	const merged = mergeValues(left.value, right.value);
	if (!merged.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
	result.value = merged.data;
	return result;
}
const $ZodTuple = /*@__PURE__*/ $constructor("$ZodTuple", (inst, def) => {
	$ZodType.init(inst, def);
	const items = def.items;
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!Array.isArray(input)) {
			payload.issues.push({
				input,
				inst,
				expected: "tuple",
				code: "invalid_type"
			});
			return payload;
		}
		payload.value = [];
		const proms = [];
		const optinStart = getTupleOptStart(items, "optin");
		const optoutStart = getTupleOptStart(items, "optout");
		if (!def.rest) {
			if (input.length < optinStart) {
				payload.issues.push({
					code: "too_small",
					minimum: optinStart,
					inclusive: true,
					input,
					inst,
					origin: "array"
				});
				return payload;
			}
			if (input.length > items.length) payload.issues.push({
				code: "too_big",
				maximum: items.length,
				inclusive: true,
				input,
				inst,
				origin: "array"
			});
		}
		const itemResults = new Array(items.length);
		for (let i = 0; i < items.length; i++) {
			const r = items[i]._zod.run({
				value: input[i],
				issues: []
			}, ctx);
			if (r instanceof Promise) proms.push(r.then((rr) => {
				itemResults[i] = rr;
			}));
			else itemResults[i] = r;
		}
		if (def.rest) {
			let i = items.length - 1;
			const rest = input.slice(items.length);
			for (const el of rest) {
				i++;
				const result = def.rest._zod.run({
					value: el,
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((r) => handleTupleResult(r, payload, i)));
				else handleTupleResult(result, payload, i);
			}
		}
		if (proms.length) return Promise.all(proms).then(() => handleTupleResults(itemResults, payload, items, input, optoutStart));
		return handleTupleResults(itemResults, payload, items, input, optoutStart);
	};
});
function getTupleOptStart(items, key) {
	for (let i = items.length - 1; i >= 0; i--) if (items[i]._zod[key] !== "optional") return i + 1;
	return 0;
}
function handleTupleResult(result, final, index) {
	if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
	final.value[index] = result.value;
}
function handleTupleResults(itemResults, final, items, input, optoutStart) {
	for (let i = 0; i < items.length; i++) {
		const r = itemResults[i];
		const isPresent = i < input.length;
		if (r.issues.length) {
			if (!isPresent && i >= optoutStart) {
				final.value.length = i;
				break;
			}
			final.issues.push(...prefixIssues(i, r.issues));
		}
		final.value[i] = r.value;
	}
	for (let i = final.value.length - 1; i >= input.length; i--) if (items[i]._zod.optout === "optional" && final.value[i] === void 0) final.value.length = i;
	else break;
	return final;
}
const $ZodRecord = /*@__PURE__*/ $constructor("$ZodRecord", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!isPlainObject(input)) {
			payload.issues.push({
				expected: "record",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		const proms = [];
		const values = def.keyType._zod.values;
		if (values) {
			payload.value = {};
			const recordKeys = /* @__PURE__ */ new Set();
			for (const key of values) if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
				recordKeys.add(typeof key === "number" ? key.toString() : key);
				const keyResult = def.keyType._zod.run({
					value: key,
					issues: []
				}, ctx);
				if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
				if (keyResult.issues.length) {
					payload.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
						input: key,
						path: [key],
						inst
					});
					continue;
				}
				const outKey = keyResult.value;
				const result = def.valueType._zod.run({
					value: input[key],
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((result) => {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}));
				else {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}
			}
			let unrecognized;
			for (const key in input) if (!recordKeys.has(key)) {
				unrecognized = unrecognized ?? [];
				unrecognized.push(key);
			}
			if (unrecognized && unrecognized.length > 0) payload.issues.push({
				code: "unrecognized_keys",
				input,
				inst,
				keys: unrecognized
			});
		} else {
			payload.value = {};
			for (const key of Reflect.ownKeys(input)) {
				if (key === "__proto__") continue;
				if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue;
				let keyResult = def.keyType._zod.run({
					value: key,
					issues: []
				}, ctx);
				if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
				if (typeof key === "string" && number$1.test(key) && keyResult.issues.length) {
					const retryResult = def.keyType._zod.run({
						value: Number(key),
						issues: []
					}, ctx);
					if (retryResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
					if (retryResult.issues.length === 0) keyResult = retryResult;
				}
				if (keyResult.issues.length) {
					if (def.mode === "loose") payload.value[key] = input[key];
					else payload.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
						input: key,
						path: [key],
						inst
					});
					continue;
				}
				const result = def.valueType._zod.run({
					value: input[key],
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((result) => {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[keyResult.value] = result.value;
				}));
				else {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[keyResult.value] = result.value;
				}
			}
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
});
const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
	$ZodType.init(inst, def);
	const values = getEnumValues(def.entries);
	const valuesSet = new Set(values);
	inst._zod.values = valuesSet;
	inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (valuesSet.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values,
			input,
			inst
		});
		return payload;
	};
});
const $ZodLiteral = /*@__PURE__*/ $constructor("$ZodLiteral", (inst, def) => {
	$ZodType.init(inst, def);
	if (def.values.length === 0) throw new Error("Cannot create literal schema with no valid values");
	const values = new Set(def.values);
	inst._zod.values = values;
	inst._zod.pattern = new RegExp(`^(${def.values.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$`);
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (values.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values: def.values,
			input,
			inst
		});
		return payload;
	};
});
const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		const _out = def.transform(payload.value, payload);
		if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
			payload.value = output;
			payload.fallback = true;
			return payload;
		});
		if (_out instanceof Promise) throw new $ZodAsyncError();
		payload.value = _out;
		payload.fallback = true;
		return payload;
	};
});
function handleOptionalResult(result, input) {
	if (input === void 0 && (result.issues.length || result.fallback)) return {
		issues: [],
		value: void 0
	};
	return result;
}
const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	inst._zod.optout = "optional";
	defineLazy(inst._zod, "values", () => {
		return def.innerType._zod.values ? new Set([...def.innerType._zod.values, void 0]) : void 0;
	});
	defineLazy(inst._zod, "pattern", () => {
		const pattern = def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (def.innerType._zod.optin === "optional") {
			const input = payload.value;
			const result = def.innerType._zod.run(payload, ctx);
			if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, input));
			return handleOptionalResult(result, input);
		}
		if (payload.value === void 0) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
	inst._zod.parse = (payload, ctx) => {
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
	defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
	defineLazy(inst._zod, "pattern", () => {
		const pattern = def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
	});
	defineLazy(inst._zod, "values", () => {
		return def.innerType._zod.values ? new Set([...def.innerType._zod.values, null]) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (payload.value === null) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) {
			payload.value = def.defaultValue;
			/**
			* $ZodDefault returns the default value immediately in forward direction.
			* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
			return payload;
		}
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
		return handleDefaultResult(result, def);
	};
});
function handleDefaultResult(payload, def) {
	if (payload.value === void 0) payload.value = def.defaultValue;
	return payload;
}
const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) payload.value = def.defaultValue;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "values", () => {
		const v = def.innerType._zod.values;
		return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
		return handleNonOptionalResult(result, inst);
	};
});
function handleNonOptionalResult(payload, inst) {
	if (!payload.issues.length && payload.value === void 0) payload.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: payload.value,
		inst
	});
	return payload;
}
const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => {
			payload.value = result.value;
			if (result.issues.length) {
				payload.value = def.catchValue({
					...payload,
					error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
					input: payload.value
				});
				payload.issues = [];
				payload.fallback = true;
			}
			return payload;
		});
		payload.value = result.value;
		if (result.issues.length) {
			payload.value = def.catchValue({
				...payload,
				error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
				input: payload.value
			});
			payload.issues = [];
			payload.fallback = true;
		}
		return payload;
	};
});
const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "values", () => def.in._zod.values);
	defineLazy(inst._zod, "optin", () => def.in._zod.optin);
	defineLazy(inst._zod, "optout", () => def.out._zod.optout);
	defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") {
			const right = def.out._zod.run(payload, ctx);
			if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
			return handlePipeResult(right, def.in, ctx);
		}
		const left = def.in._zod.run(payload, ctx);
		if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
		return handlePipeResult(left, def.out, ctx);
	};
});
function handlePipeResult(left, next, ctx) {
	if (left.issues.length) {
		left.aborted = true;
		return left;
	}
	return next._zod.run({
		value: left.value,
		issues: left.issues,
		fallback: left.fallback
	}, ctx);
}
const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
	defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then(handleReadonlyResult);
		return handleReadonlyResult(result);
	};
});
function handleReadonlyResult(payload) {
	payload.value = Object.freeze(payload.value);
	return payload;
}
const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
	$ZodCheck.init(inst, def);
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _) => {
		return payload;
	};
	inst._zod.check = (payload) => {
		const input = payload.value;
		const r = def.fn(input);
		if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
		handleRefineResult(r, payload, input, inst);
	};
});
function handleRefineResult(result, payload, input, inst) {
	if (!result) {
		const _iss = {
			code: "custom",
			input,
			inst,
			path: [...inst._zod.def.path ?? []],
			continue: !inst._zod.def.abort
		};
		if (inst._zod.def.params) _iss.params = inst._zod.def.params;
		payload.issues.push(issue(_iss));
	}
}
//#endregion
//#region node_modules/zod/v4/core/registries.js
var _a;
var $ZodRegistry = class {
	constructor() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
	}
	add(schema, ..._meta) {
		const meta = _meta[0];
		this._map.set(schema, meta);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
		return this;
	}
	clear() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
		return this;
	}
	remove(schema) {
		const meta = this._map.get(schema);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
		this._map.delete(schema);
		return this;
	}
	get(schema) {
		const p = schema._zod.parent;
		if (p) {
			const pm = { ...this.get(p) ?? {} };
			delete pm.id;
			const f = {
				...pm,
				...this._map.get(schema)
			};
			return Object.keys(f).length ? f : void 0;
		}
		return this._map.get(schema);
	}
	has(schema) {
		return this._map.has(schema);
	}
};
function registry() {
	return new $ZodRegistry();
}
(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
const globalRegistry = globalThis.__zod_globalRegistry;
//#endregion
//#region node_modules/zod/v4/core/api.js
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
	return new Class({
		type: "string",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _email(Class, params) {
	return new Class({
		type: "string",
		format: "email",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _guid(Class, params) {
	return new Class({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v4",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v6",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v7",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _url(Class, params) {
	return new Class({
		type: "string",
		format: "url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _emoji(Class, params) {
	return new Class({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class, params) {
	return new Class({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link _cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
// @__NO_SIDE_EFFECTS__
function _cuid(Class, params) {
	return new Class({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class, params) {
	return new Class({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class, params) {
	return new Class({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _xid(Class, params) {
	return new Class({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class, params) {
	return new Class({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class, params) {
	return new Class({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class, params) {
	return new Class({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64(Class, params) {
	return new Class({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class, params) {
	return new Class({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _e164(Class, params) {
	return new Class({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class, params) {
	return new Class({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class, params) {
	return new Class({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: false,
		local: false,
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class, params) {
	return new Class({
		type: "string",
		format: "date",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class, params) {
	return new Class({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class, params) {
	return new Class({
		type: "string",
		format: "duration",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _number(Class, params) {
	return new Class({
		type: "number",
		checks: [],
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _int(Class, params) {
	return new Class({
		type: "number",
		check: "number_format",
		abort: false,
		format: "safeint",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class, params) {
	return new Class({
		type: "boolean",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class) {
	return new Class({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function _never(Class, params) {
	return new Class({
		type: "never",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
	return new $ZodCheckMultipleOf({
		check: "multiple_of",
		...normalizeParams(params),
		value
	});
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
	return new $ZodCheckMaxLength({
		check: "max_length",
		...normalizeParams(params),
		maximum
	});
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
	return new $ZodCheckMinLength({
		check: "min_length",
		...normalizeParams(params),
		minimum
	});
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
	return new $ZodCheckLengthEquals({
		check: "length_equals",
		...normalizeParams(params),
		length
	});
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
	return new $ZodCheckRegex({
		check: "string_format",
		format: "regex",
		...normalizeParams(params),
		pattern
	});
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
	return new $ZodCheckLowerCase({
		check: "string_format",
		format: "lowercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
	return new $ZodCheckUpperCase({
		check: "string_format",
		format: "uppercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
	return new $ZodCheckIncludes({
		check: "string_format",
		format: "includes",
		...normalizeParams(params),
		includes
	});
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
	return new $ZodCheckStartsWith({
		check: "string_format",
		format: "starts_with",
		...normalizeParams(params),
		prefix
	});
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
	return new $ZodCheckEndsWith({
		check: "string_format",
		format: "ends_with",
		...normalizeParams(params),
		suffix
	});
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
	return new $ZodCheckOverwrite({
		check: "overwrite",
		tx
	});
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
	return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
	return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
	return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class, element, params) {
	return new Class({
		type: "array",
		element,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _refine(Class, fn, _params) {
	return new Class({
		type: "custom",
		check: "custom",
		fn,
		...normalizeParams(_params)
	});
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
	const ch = /* @__PURE__ */ _check((payload) => {
		payload.addIssue = (issue$2) => {
			if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
			else {
				const _issue = issue$2;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				_issue.input ?? (_issue.input = payload.value);
				_issue.inst ?? (_issue.inst = ch);
				_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
				payload.issues.push(issue(_issue));
			}
		};
		return fn(payload.value, payload);
	}, params);
	return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
	const ch = new $ZodCheck({
		check: "custom",
		...normalizeParams(params)
	});
	ch._zod.check = fn;
	return ch;
}
//#endregion
//#region node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
	let target = params?.target ?? "draft-2020-12";
	if (target === "draft-4") target = "draft-04";
	if (target === "draft-7") target = "draft-07";
	return {
		processors: params.processors ?? {},
		metadataRegistry: params?.metadata ?? globalRegistry,
		target,
		unrepresentable: params?.unrepresentable ?? "throw",
		override: params?.override ?? (() => {}),
		io: params?.io ?? "output",
		counter: 0,
		seen: /* @__PURE__ */ new Map(),
		cycles: params?.cycles ?? "ref",
		reused: params?.reused ?? "inline",
		external: params?.external ?? void 0
	};
}
function process$1(schema, ctx, _params = {
	path: [],
	schemaPath: []
}) {
	var _a;
	const def = schema._zod.def;
	const seen = ctx.seen.get(schema);
	if (seen) {
		seen.count++;
		if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
		return seen.schema;
	}
	const result = {
		schema: {},
		count: 1,
		cycle: void 0,
		path: _params.path
	};
	ctx.seen.set(schema, result);
	const overrideSchema = schema._zod.toJSONSchema?.();
	if (overrideSchema) result.schema = overrideSchema;
	else {
		const params = {
			..._params,
			schemaPath: [..._params.schemaPath, schema],
			path: _params.path
		};
		if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
		else {
			const _json = result.schema;
			const processor = ctx.processors[def.type];
			if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
			processor(schema, ctx, _json, params);
		}
		const parent = schema._zod.parent;
		if (parent) {
			if (!result.ref) result.ref = parent;
			process$1(parent, ctx, params);
			ctx.seen.get(parent).isParent = true;
		}
	}
	const meta = ctx.metadataRegistry.get(schema);
	if (meta) Object.assign(result.schema, meta);
	if (ctx.io === "input" && isTransforming(schema)) {
		delete result.schema.examples;
		delete result.schema.default;
	}
	if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
	delete result.schema._prefault;
	return ctx.seen.get(schema).schema;
}
function extractDefs(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const idToSchema = /* @__PURE__ */ new Map();
	for (const entry of ctx.seen.entries()) {
		const id = ctx.metadataRegistry.get(entry[0])?.id;
		if (id) {
			const existing = idToSchema.get(id);
			if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
			idToSchema.set(id, entry[0]);
		}
	}
	const makeURI = (entry) => {
		const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
		if (ctx.external) {
			const externalId = ctx.external.registry.get(entry[0])?.id;
			const uriGenerator = ctx.external.uri ?? ((id) => id);
			if (externalId) return { ref: uriGenerator(externalId) };
			const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
			entry[1].defId = id;
			return {
				defId: id,
				ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
			};
		}
		if (entry[1] === root) return { ref: "#" };
		const defUriPrefix = `#/${defsSegment}/`;
		const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
		return {
			defId,
			ref: defUriPrefix + defId
		};
	};
	const extractToDef = (entry) => {
		if (entry[1].schema.$ref) return;
		const seen = entry[1];
		const { ref, defId } = makeURI(entry);
		seen.def = { ...seen.schema };
		if (defId) seen.defId = defId;
		const schema = seen.schema;
		for (const key in schema) delete schema[key];
		schema.$ref = ref;
	};
	if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
	}
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (schema === entry[0]) {
			extractToDef(entry);
			continue;
		}
		if (ctx.external) {
			const ext = ctx.external.registry.get(entry[0])?.id;
			if (schema !== entry[0] && ext) {
				extractToDef(entry);
				continue;
			}
		}
		if (ctx.metadataRegistry.get(entry[0])?.id) {
			extractToDef(entry);
			continue;
		}
		if (seen.cycle) {
			extractToDef(entry);
			continue;
		}
		if (seen.count > 1) {
			if (ctx.reused === "ref") {
				extractToDef(entry);
				continue;
			}
		}
	}
}
function finalize(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const flattenRef = (zodSchema) => {
		const seen = ctx.seen.get(zodSchema);
		if (seen.ref === null) return;
		const schema = seen.def ?? seen.schema;
		const _cached = { ...schema };
		const ref = seen.ref;
		seen.ref = null;
		if (ref) {
			flattenRef(ref);
			const refSeen = ctx.seen.get(ref);
			const refSchema = refSeen.schema;
			if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
				schema.allOf = schema.allOf ?? [];
				schema.allOf.push(refSchema);
			} else Object.assign(schema, refSchema);
			Object.assign(schema, _cached);
			if (zodSchema._zod.parent === ref) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (!(key in _cached)) delete schema[key];
			}
			if (refSchema.$ref && refSeen.def) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
			}
		}
		const parent = zodSchema._zod.parent;
		if (parent && parent !== ref) {
			flattenRef(parent);
			const parentSeen = ctx.seen.get(parent);
			if (parentSeen?.schema.$ref) {
				schema.$ref = parentSeen.schema.$ref;
				if (parentSeen.def) for (const key in schema) {
					if (key === "$ref" || key === "allOf") continue;
					if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
				}
			}
		}
		ctx.override({
			zodSchema,
			jsonSchema: schema,
			path: seen.path ?? []
		});
	};
	for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
	const result = {};
	if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
	else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
	else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
	else if (ctx.target === "openapi-3.0") {}
	if (ctx.external?.uri) {
		const id = ctx.external.registry.get(schema)?.id;
		if (!id) throw new Error("Schema is missing an `id` property");
		result.$id = ctx.external.uri(id);
	}
	Object.assign(result, root.def ?? root.schema);
	const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
	if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
	const defs = ctx.external?.defs ?? {};
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.def && seen.defId) {
			if (seen.def.id === seen.defId) delete seen.def.id;
			defs[seen.defId] = seen.def;
		}
	}
	if (ctx.external) {} else if (Object.keys(defs).length > 0) if (ctx.target === "draft-2020-12") result.$defs = defs;
	else result.definitions = defs;
	try {
		const finalized = JSON.parse(JSON.stringify(result));
		Object.defineProperty(finalized, "~standard", {
			value: {
				...schema["~standard"],
				jsonSchema: {
					input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
					output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
				}
			},
			enumerable: false,
			writable: false
		});
		return finalized;
	} catch (_err) {
		throw new Error("Error converting schema to JSON.");
	}
}
function isTransforming(_schema, _ctx) {
	const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
	if (ctx.seen.has(_schema)) return false;
	ctx.seen.add(_schema);
	const def = _schema._zod.def;
	if (def.type === "transform") return true;
	if (def.type === "array") return isTransforming(def.element, ctx);
	if (def.type === "set") return isTransforming(def.valueType, ctx);
	if (def.type === "lazy") return isTransforming(def.getter(), ctx);
	if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
	if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
	if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
	if (def.type === "pipe") {
		if (_schema._zod.traits.has("$ZodCodec")) return true;
		return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
	}
	if (def.type === "object") {
		for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
		return false;
	}
	if (def.type === "union") {
		for (const option of def.options) if (isTransforming(option, ctx)) return true;
		return false;
	}
	if (def.type === "tuple") {
		for (const item of def.items) if (isTransforming(item, ctx)) return true;
		if (def.rest && isTransforming(def.rest, ctx)) return true;
		return false;
	}
	return false;
}
/**
* Creates a toJSONSchema method for a schema instance.
* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
*/
const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
	const ctx = initializeContext({
		...params,
		processors
	});
	process$1(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
	const { libraryOptions, target } = params ?? {};
	const ctx = initializeContext({
		...libraryOptions ?? {},
		target,
		io,
		processors
	});
	process$1(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
//#endregion
//#region node_modules/zod/v4/core/json-schema-processors.js
const formatMap = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
};
const stringProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	json.type = "string";
	const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
	if (typeof minimum === "number") json.minLength = minimum;
	if (typeof maximum === "number") json.maxLength = maximum;
	if (format) {
		json.format = formatMap[format] ?? format;
		if (json.format === "") delete json.format;
		if (format === "time") delete json.format;
	}
	if (contentEncoding) json.contentEncoding = contentEncoding;
	if (patterns && patterns.size > 0) {
		const regexes = [...patterns];
		if (regexes.length === 1) json.pattern = regexes[0].source;
		else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
			...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: regex.source
		}))];
	}
};
const numberProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
	if (typeof format === "string" && format.includes("int")) json.type = "integer";
	else json.type = "number";
	const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
	const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
	const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
	if (exMin) if (legacy) {
		json.minimum = exclusiveMinimum;
		json.exclusiveMinimum = true;
	} else json.exclusiveMinimum = exclusiveMinimum;
	else if (typeof minimum === "number") json.minimum = minimum;
	if (exMax) if (legacy) {
		json.maximum = exclusiveMaximum;
		json.exclusiveMaximum = true;
	} else json.exclusiveMaximum = exclusiveMaximum;
	else if (typeof maximum === "number") json.maximum = maximum;
	if (typeof multipleOf === "number") json.multipleOf = multipleOf;
};
const booleanProcessor = (_schema, _ctx, json, _params) => {
	json.type = "boolean";
};
const neverProcessor = (_schema, _ctx, json, _params) => {
	json.not = {};
};
const enumProcessor = (schema, _ctx, json, _params) => {
	const def = schema._zod.def;
	const values = getEnumValues(def.entries);
	if (values.every((v) => typeof v === "number")) json.type = "number";
	if (values.every((v) => typeof v === "string")) json.type = "string";
	json.enum = values;
};
const literalProcessor = (schema, ctx, json, _params) => {
	const def = schema._zod.def;
	const vals = [];
	for (const val of def.values) if (val === void 0) {
		if (ctx.unrepresentable === "throw") throw new Error("Literal `undefined` cannot be represented in JSON Schema");
	} else if (typeof val === "bigint") if (ctx.unrepresentable === "throw") throw new Error("BigInt literals cannot be represented in JSON Schema");
	else vals.push(Number(val));
	else vals.push(val);
	if (vals.length === 0) {} else if (vals.length === 1) {
		const val = vals[0];
		json.type = val === null ? "null" : typeof val;
		if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") json.enum = [val];
		else json.const = val;
	} else {
		if (vals.every((v) => typeof v === "number")) json.type = "number";
		if (vals.every((v) => typeof v === "string")) json.type = "string";
		if (vals.every((v) => typeof v === "boolean")) json.type = "boolean";
		if (vals.every((v) => v === null)) json.type = "null";
		json.enum = vals;
	}
};
const customProcessor = (_schema, ctx, _json, _params) => {
	if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
};
const transformProcessor = (_schema, ctx, _json, _params) => {
	if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
};
const arrayProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	const { minimum, maximum } = schema._zod.bag;
	if (typeof minimum === "number") json.minItems = minimum;
	if (typeof maximum === "number") json.maxItems = maximum;
	json.type = "array";
	json.items = process$1(def.element, ctx, {
		...params,
		path: [...params.path, "items"]
	});
};
const objectProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "object";
	json.properties = {};
	const shape = def.shape;
	for (const key in shape) json.properties[key] = process$1(shape[key], ctx, {
		...params,
		path: [
			...params.path,
			"properties",
			key
		]
	});
	const allKeys = new Set(Object.keys(shape));
	const requiredKeys = new Set([...allKeys].filter((key) => {
		const v = def.shape[key]._zod;
		if (ctx.io === "input") return v.optin === void 0;
		else return v.optout === void 0;
	}));
	if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
	if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
	else if (!def.catchall) {
		if (ctx.io === "output") json.additionalProperties = false;
	} else if (def.catchall) json.additionalProperties = process$1(def.catchall, ctx, {
		...params,
		path: [...params.path, "additionalProperties"]
	});
};
const unionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const isExclusive = def.inclusive === false;
	const options = def.options.map((x, i) => process$1(x, ctx, {
		...params,
		path: [
			...params.path,
			isExclusive ? "oneOf" : "anyOf",
			i
		]
	}));
	if (isExclusive) json.oneOf = options;
	else json.anyOf = options;
};
const intersectionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const a = process$1(def.left, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			0
		]
	});
	const b = process$1(def.right, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			1
		]
	});
	const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
	json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
};
const tupleProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "array";
	const prefixPath = ctx.target === "draft-2020-12" ? "prefixItems" : "items";
	const restPath = ctx.target === "draft-2020-12" ? "items" : ctx.target === "openapi-3.0" ? "items" : "additionalItems";
	const prefixItems = def.items.map((x, i) => process$1(x, ctx, {
		...params,
		path: [
			...params.path,
			prefixPath,
			i
		]
	}));
	const rest = def.rest ? process$1(def.rest, ctx, {
		...params,
		path: [
			...params.path,
			restPath,
			...ctx.target === "openapi-3.0" ? [def.items.length] : []
		]
	}) : null;
	if (ctx.target === "draft-2020-12") {
		json.prefixItems = prefixItems;
		if (rest) json.items = rest;
	} else if (ctx.target === "openapi-3.0") {
		json.items = { anyOf: prefixItems };
		if (rest) json.items.anyOf.push(rest);
		json.minItems = prefixItems.length;
		if (!rest) json.maxItems = prefixItems.length;
	} else {
		json.items = prefixItems;
		if (rest) json.additionalItems = rest;
	}
	const { minimum, maximum } = schema._zod.bag;
	if (typeof minimum === "number") json.minItems = minimum;
	if (typeof maximum === "number") json.maxItems = maximum;
};
const recordProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "object";
	const keyType = def.keyType;
	const patterns = keyType._zod.bag?.patterns;
	if (def.mode === "loose" && patterns && patterns.size > 0) {
		const valueSchema = process$1(def.valueType, ctx, {
			...params,
			path: [
				...params.path,
				"patternProperties",
				"*"
			]
		});
		json.patternProperties = {};
		for (const pattern of patterns) json.patternProperties[pattern.source] = valueSchema;
	} else {
		if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") json.propertyNames = process$1(def.keyType, ctx, {
			...params,
			path: [...params.path, "propertyNames"]
		});
		json.additionalProperties = process$1(def.valueType, ctx, {
			...params,
			path: [...params.path, "additionalProperties"]
		});
	}
	const keyValues = keyType._zod.values;
	if (keyValues) {
		const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
		if (validKeyValues.length > 0) json.required = validKeyValues;
	}
};
const nullableProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const inner = process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	if (ctx.target === "openapi-3.0") {
		seen.ref = def.innerType;
		json.nullable = true;
	} else json.anyOf = [inner, { type: "null" }];
};
const nonoptionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
const defaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.default = JSON.parse(JSON.stringify(def.defaultValue));
};
const prefaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
const catchProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	let catchValue;
	try {
		catchValue = def.catchValue(void 0);
	} catch {
		throw new Error("Dynamic catch values are not supported in JSON Schema");
	}
	json.default = catchValue;
};
const pipeProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	const inIsTransform = def.in._zod.traits.has("$ZodTransform");
	const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
	process$1(innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = innerType;
};
const readonlyProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.readOnly = true;
};
const optionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process$1(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
//#endregion
//#region node_modules/zod/v4/classic/iso.js
const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
	$ZodISODateTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function datetime(params) {
	return /* @__PURE__ */ _isoDateTime(ZodISODateTime, params);
}
const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
	$ZodISODate.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function date(params) {
	return /* @__PURE__ */ _isoDate(ZodISODate, params);
}
const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
	$ZodISOTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function time(params) {
	return /* @__PURE__ */ _isoTime(ZodISOTime, params);
}
const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
	$ZodISODuration.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function duration(params) {
	return /* @__PURE__ */ _isoDuration(ZodISODuration, params);
}
//#endregion
//#region node_modules/zod/v4/classic/errors.js
const initializer = (inst, issues) => {
	$ZodError.init(inst, issues);
	inst.name = "ZodError";
	Object.defineProperties(inst, {
		format: { value: (mapper) => formatError(inst, mapper) },
		flatten: { value: (mapper) => flattenError(inst, mapper) },
		addIssue: { value: (issue) => {
			inst.issues.push(issue);
			inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
		} },
		addIssues: { value: (issues) => {
			inst.issues.push(...issues);
			inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
		} },
		isEmpty: { get() {
			return inst.issues.length === 0;
		} }
	});
};
const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, { Parent: Error });
//#endregion
//#region node_modules/zod/v4/classic/parse.js
const parse = /* @__PURE__ */ _parse(ZodRealError);
const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
const encode = /* @__PURE__ */ _encode(ZodRealError);
const decode = /* @__PURE__ */ _decode(ZodRealError);
const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);
//#endregion
//#region node_modules/zod/v4/classic/schemas.js
const _installedGroups = /* @__PURE__ */ new WeakMap();
function _installLazyMethods(inst, group, methods) {
	const proto = Object.getPrototypeOf(inst);
	let installed = _installedGroups.get(proto);
	if (!installed) {
		installed = /* @__PURE__ */ new Set();
		_installedGroups.set(proto, installed);
	}
	if (installed.has(group)) return;
	installed.add(group);
	for (const key in methods) {
		const fn = methods[key];
		Object.defineProperty(proto, key, {
			configurable: true,
			enumerable: false,
			get() {
				const bound = fn.bind(this);
				Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					enumerable: true,
					value: bound
				});
				return bound;
			},
			set(v) {
				Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					enumerable: true,
					value: v
				});
			}
		});
	}
}
const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
	$ZodType.init(inst, def);
	Object.assign(inst["~standard"], { jsonSchema: {
		input: createStandardJSONSchemaMethod(inst, "input"),
		output: createStandardJSONSchemaMethod(inst, "output")
	} });
	inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
	inst.def = def;
	inst.type = def.type;
	Object.defineProperty(inst, "_def", { value: def });
	inst.parse = (data, params) => parse(inst, data, params, { callee: inst.parse });
	inst.safeParse = (data, params) => safeParse(inst, data, params);
	inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
	inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
	inst.spa = inst.safeParseAsync;
	inst.encode = (data, params) => encode(inst, data, params);
	inst.decode = (data, params) => decode(inst, data, params);
	inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
	inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
	inst.safeEncode = (data, params) => safeEncode(inst, data, params);
	inst.safeDecode = (data, params) => safeDecode(inst, data, params);
	inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
	inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
	_installLazyMethods(inst, "ZodType", {
		check(...chks) {
			const def = this.def;
			return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
				check: ch,
				def: { check: "custom" },
				onattach: []
			} } : ch)] }), { parent: true });
		},
		with(...chks) {
			return this.check(...chks);
		},
		clone(def, params) {
			return clone(this, def, params);
		},
		brand() {
			return this;
		},
		register(reg, meta) {
			reg.add(this, meta);
			return this;
		},
		refine(check, params) {
			return this.check(refine(check, params));
		},
		superRefine(refinement, params) {
			return this.check(superRefine(refinement, params));
		},
		overwrite(fn) {
			return this.check(/* @__PURE__ */ _overwrite(fn));
		},
		optional() {
			return optional(this);
		},
		exactOptional() {
			return exactOptional(this);
		},
		nullable() {
			return nullable(this);
		},
		nullish() {
			return optional(nullable(this));
		},
		nonoptional(params) {
			return nonoptional(this, params);
		},
		array() {
			return array(this);
		},
		or(arg) {
			return union([this, arg]);
		},
		and(arg) {
			return intersection(this, arg);
		},
		transform(tx) {
			return pipe(this, transform(tx));
		},
		default(d) {
			return _default(this, d);
		},
		prefault(d) {
			return prefault(this, d);
		},
		catch(params) {
			return _catch(this, params);
		},
		pipe(target) {
			return pipe(this, target);
		},
		readonly() {
			return readonly(this);
		},
		describe(description) {
			const cl = this.clone();
			globalRegistry.add(cl, { description });
			return cl;
		},
		meta(...args) {
			if (args.length === 0) return globalRegistry.get(this);
			const cl = this.clone();
			globalRegistry.add(cl, args[0]);
			return cl;
		},
		isOptional() {
			return this.safeParse(void 0).success;
		},
		isNullable() {
			return this.safeParse(null).success;
		},
		apply(fn) {
			return fn(this);
		}
	});
	Object.defineProperty(inst, "description", {
		get() {
			return globalRegistry.get(inst)?.description;
		},
		configurable: true
	});
	return inst;
});
/** @internal */
const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
	const bag = inst._zod.bag;
	inst.format = bag.format ?? null;
	inst.minLength = bag.minimum ?? null;
	inst.maxLength = bag.maximum ?? null;
	_installLazyMethods(inst, "_ZodString", {
		regex(...args) {
			return this.check(/* @__PURE__ */ _regex(...args));
		},
		includes(...args) {
			return this.check(/* @__PURE__ */ _includes(...args));
		},
		startsWith(...args) {
			return this.check(/* @__PURE__ */ _startsWith(...args));
		},
		endsWith(...args) {
			return this.check(/* @__PURE__ */ _endsWith(...args));
		},
		min(...args) {
			return this.check(/* @__PURE__ */ _minLength(...args));
		},
		max(...args) {
			return this.check(/* @__PURE__ */ _maxLength(...args));
		},
		length(...args) {
			return this.check(/* @__PURE__ */ _length(...args));
		},
		nonempty(...args) {
			return this.check(/* @__PURE__ */ _minLength(1, ...args));
		},
		lowercase(params) {
			return this.check(/* @__PURE__ */ _lowercase(params));
		},
		uppercase(params) {
			return this.check(/* @__PURE__ */ _uppercase(params));
		},
		trim() {
			return this.check(/* @__PURE__ */ _trim());
		},
		normalize(...args) {
			return this.check(/* @__PURE__ */ _normalize(...args));
		},
		toLowerCase() {
			return this.check(/* @__PURE__ */ _toLowerCase());
		},
		toUpperCase() {
			return this.check(/* @__PURE__ */ _toUpperCase());
		},
		slugify() {
			return this.check(/* @__PURE__ */ _slugify());
		}
	});
});
const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	_ZodString.init(inst, def);
	inst.email = (params) => inst.check(/* @__PURE__ */ _email(ZodEmail, params));
	inst.url = (params) => inst.check(/* @__PURE__ */ _url(ZodURL, params));
	inst.jwt = (params) => inst.check(/* @__PURE__ */ _jwt(ZodJWT, params));
	inst.emoji = (params) => inst.check(/* @__PURE__ */ _emoji(ZodEmoji, params));
	inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
	inst.uuid = (params) => inst.check(/* @__PURE__ */ _uuid(ZodUUID, params));
	inst.uuidv4 = (params) => inst.check(/* @__PURE__ */ _uuidv4(ZodUUID, params));
	inst.uuidv6 = (params) => inst.check(/* @__PURE__ */ _uuidv6(ZodUUID, params));
	inst.uuidv7 = (params) => inst.check(/* @__PURE__ */ _uuidv7(ZodUUID, params));
	inst.nanoid = (params) => inst.check(/* @__PURE__ */ _nanoid(ZodNanoID, params));
	inst.guid = (params) => inst.check(/* @__PURE__ */ _guid(ZodGUID, params));
	inst.cuid = (params) => inst.check(/* @__PURE__ */ _cuid(ZodCUID, params));
	inst.cuid2 = (params) => inst.check(/* @__PURE__ */ _cuid2(ZodCUID2, params));
	inst.ulid = (params) => inst.check(/* @__PURE__ */ _ulid(ZodULID, params));
	inst.base64 = (params) => inst.check(/* @__PURE__ */ _base64(ZodBase64, params));
	inst.base64url = (params) => inst.check(/* @__PURE__ */ _base64url(ZodBase64URL, params));
	inst.xid = (params) => inst.check(/* @__PURE__ */ _xid(ZodXID, params));
	inst.ksuid = (params) => inst.check(/* @__PURE__ */ _ksuid(ZodKSUID, params));
	inst.ipv4 = (params) => inst.check(/* @__PURE__ */ _ipv4(ZodIPv4, params));
	inst.ipv6 = (params) => inst.check(/* @__PURE__ */ _ipv6(ZodIPv6, params));
	inst.cidrv4 = (params) => inst.check(/* @__PURE__ */ _cidrv4(ZodCIDRv4, params));
	inst.cidrv6 = (params) => inst.check(/* @__PURE__ */ _cidrv6(ZodCIDRv6, params));
	inst.e164 = (params) => inst.check(/* @__PURE__ */ _e164(ZodE164, params));
	inst.datetime = (params) => inst.check(datetime(params));
	inst.date = (params) => inst.check(date(params));
	inst.time = (params) => inst.check(time(params));
	inst.duration = (params) => inst.check(duration(params));
});
function string(params) {
	return /* @__PURE__ */ _string(ZodString, params);
}
const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	_ZodString.init(inst, def);
});
const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
	$ZodEmail.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function email(params) {
	return /* @__PURE__ */ _email(ZodEmail, params);
}
const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
	$ZodGUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
	$ZodUUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
	$ZodURL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function url(params) {
	return /* @__PURE__ */ _url(ZodURL, params);
}
const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
	$ZodEmoji.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
	$ZodNanoID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
	$ZodCUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
	$ZodCUID2.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
	$ZodULID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
	$ZodXID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
	$ZodKSUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
	$ZodIPv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
	$ZodIPv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
	$ZodCIDRv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
	$ZodCIDRv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
	$ZodBase64.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
	$ZodBase64URL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
	$ZodE164.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
	$ZodJWT.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
	$ZodNumber.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
	_installLazyMethods(inst, "ZodNumber", {
		gt(value, params) {
			return this.check(/* @__PURE__ */ _gt(value, params));
		},
		gte(value, params) {
			return this.check(/* @__PURE__ */ _gte(value, params));
		},
		min(value, params) {
			return this.check(/* @__PURE__ */ _gte(value, params));
		},
		lt(value, params) {
			return this.check(/* @__PURE__ */ _lt(value, params));
		},
		lte(value, params) {
			return this.check(/* @__PURE__ */ _lte(value, params));
		},
		max(value, params) {
			return this.check(/* @__PURE__ */ _lte(value, params));
		},
		int(params) {
			return this.check(int(params));
		},
		safe(params) {
			return this.check(int(params));
		},
		positive(params) {
			return this.check(/* @__PURE__ */ _gt(0, params));
		},
		nonnegative(params) {
			return this.check(/* @__PURE__ */ _gte(0, params));
		},
		negative(params) {
			return this.check(/* @__PURE__ */ _lt(0, params));
		},
		nonpositive(params) {
			return this.check(/* @__PURE__ */ _lte(0, params));
		},
		multipleOf(value, params) {
			return this.check(/* @__PURE__ */ _multipleOf(value, params));
		},
		step(value, params) {
			return this.check(/* @__PURE__ */ _multipleOf(value, params));
		},
		finite() {
			return this;
		}
	});
	const bag = inst._zod.bag;
	inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
	inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
	inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? .5);
	inst.isFinite = true;
	inst.format = bag.format ?? null;
});
function number(params) {
	return /* @__PURE__ */ _number(ZodNumber, params);
}
const ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
	$ZodNumberFormat.init(inst, def);
	ZodNumber.init(inst, def);
});
function int(params) {
	return /* @__PURE__ */ _int(ZodNumberFormat, params);
}
const ZodBoolean = /*@__PURE__*/ $constructor("ZodBoolean", (inst, def) => {
	$ZodBoolean.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean(params) {
	return /* @__PURE__ */ _boolean(ZodBoolean, params);
}
const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
	$ZodUnknown.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => void 0;
});
function unknown() {
	return /* @__PURE__ */ _unknown(ZodUnknown);
}
const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
	$ZodNever.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
	return /* @__PURE__ */ _never(ZodNever, params);
}
const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
	$ZodArray.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
	inst.element = def.element;
	_installLazyMethods(inst, "ZodArray", {
		min(n, params) {
			return this.check(/* @__PURE__ */ _minLength(n, params));
		},
		nonempty(params) {
			return this.check(/* @__PURE__ */ _minLength(1, params));
		},
		max(n, params) {
			return this.check(/* @__PURE__ */ _maxLength(n, params));
		},
		length(n, params) {
			return this.check(/* @__PURE__ */ _length(n, params));
		},
		unwrap() {
			return this.element;
		}
	});
});
function array(element, params) {
	return /* @__PURE__ */ _array(ZodArray, element, params);
}
const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
	$ZodObjectJIT.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
	defineLazy(inst, "shape", () => {
		return def.shape;
	});
	_installLazyMethods(inst, "ZodObject", {
		keyof() {
			return _enum(Object.keys(this._zod.def.shape));
		},
		catchall(catchall) {
			return this.clone({
				...this._zod.def,
				catchall
			});
		},
		passthrough() {
			return this.clone({
				...this._zod.def,
				catchall: unknown()
			});
		},
		loose() {
			return this.clone({
				...this._zod.def,
				catchall: unknown()
			});
		},
		strict() {
			return this.clone({
				...this._zod.def,
				catchall: never()
			});
		},
		strip() {
			return this.clone({
				...this._zod.def,
				catchall: void 0
			});
		},
		extend(incoming) {
			return extend(this, incoming);
		},
		safeExtend(incoming) {
			return safeExtend(this, incoming);
		},
		merge(other) {
			return merge(this, other);
		},
		pick(mask) {
			return pick(this, mask);
		},
		omit(mask) {
			return omit(this, mask);
		},
		partial(...args) {
			return partial(ZodOptional, this, args[0]);
		},
		required(...args) {
			return required(ZodNonOptional, this, args[0]);
		}
	});
});
function object(shape, params) {
	return new ZodObject({
		type: "object",
		shape: shape ?? {},
		...normalizeParams(params)
	});
}
function looseObject(shape, params) {
	return new ZodObject({
		type: "object",
		shape,
		catchall: unknown(),
		...normalizeParams(params)
	});
}
const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
	$ZodUnion.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
	inst.options = def.options;
});
function union(options, params) {
	return new ZodUnion({
		type: "union",
		options,
		...normalizeParams(params)
	});
}
const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
	$ZodIntersection.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
	return new ZodIntersection({
		type: "intersection",
		left,
		right
	});
}
const ZodTuple = /*@__PURE__*/ $constructor("ZodTuple", (inst, def) => {
	$ZodTuple.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => tupleProcessor(inst, ctx, json, params);
	inst.rest = (rest) => inst.clone({
		...inst._zod.def,
		rest
	});
});
function tuple(items, _paramsOrRest, _params) {
	const hasRest = _paramsOrRest instanceof $ZodType;
	return new ZodTuple({
		type: "tuple",
		items,
		rest: hasRest ? _paramsOrRest : null,
		...normalizeParams(hasRest ? _params : _paramsOrRest)
	});
}
const ZodRecord = /*@__PURE__*/ $constructor("ZodRecord", (inst, def) => {
	$ZodRecord.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
	inst.keyType = def.keyType;
	inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
	if (!valueType || !valueType._zod) return new ZodRecord({
		type: "record",
		keyType: string(),
		valueType: keyType,
		...normalizeParams(valueType)
	});
	return new ZodRecord({
		type: "record",
		keyType,
		valueType,
		...normalizeParams(params)
	});
}
const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
	$ZodEnum.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
	inst.enum = def.entries;
	inst.options = Object.values(def.entries);
	const keys = new Set(Object.keys(def.entries));
	inst.extract = (values, params) => {
		const newEntries = {};
		for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
	inst.exclude = (values, params) => {
		const newEntries = { ...def.entries };
		for (const value of values) if (keys.has(value)) delete newEntries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
});
function _enum(values, params) {
	return new ZodEnum({
		type: "enum",
		entries: Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values,
		...normalizeParams(params)
	});
}
const ZodLiteral = /*@__PURE__*/ $constructor("ZodLiteral", (inst, def) => {
	$ZodLiteral.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
	inst.values = new Set(def.values);
	Object.defineProperty(inst, "value", { get() {
		if (def.values.length > 1) throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
		return def.values[0];
	} });
});
function literal(value, params) {
	return new ZodLiteral({
		type: "literal",
		values: Array.isArray(value) ? value : [value],
		...normalizeParams(params)
	});
}
const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
	$ZodTransform.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
	inst._zod.parse = (payload, _ctx) => {
		if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		payload.addIssue = (issue$1) => {
			if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
			else {
				const _issue = issue$1;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				_issue.input ?? (_issue.input = payload.value);
				_issue.inst ?? (_issue.inst = inst);
				payload.issues.push(issue(_issue));
			}
		};
		const output = def.transform(payload.value, payload);
		if (output instanceof Promise) return output.then((output) => {
			payload.value = output;
			payload.fallback = true;
			return payload;
		});
		payload.value = output;
		payload.fallback = true;
		return payload;
	};
});
function transform(fn) {
	return new ZodTransform({
		type: "transform",
		transform: fn
	});
}
const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
	return new ZodOptional({
		type: "optional",
		innerType
	});
}
const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
	$ZodExactOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
	return new ZodExactOptional({
		type: "optional",
		innerType
	});
}
const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
	$ZodNullable.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
	return new ZodNullable({
		type: "nullable",
		innerType
	});
}
const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
	$ZodDefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
	return new ZodDefault({
		type: "default",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
	$ZodPrefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
	return new ZodPrefault({
		type: "prefault",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
	$ZodNonOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
	return new ZodNonOptional({
		type: "nonoptional",
		innerType,
		...normalizeParams(params)
	});
}
const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
	$ZodCatch.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
	return new ZodCatch({
		type: "catch",
		innerType,
		catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
	});
}
const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
	$ZodPipe.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
	inst.in = def.in;
	inst.out = def.out;
});
function pipe(in_, out) {
	return new ZodPipe({
		type: "pipe",
		in: in_,
		out
	});
}
const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
	$ZodReadonly.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
	return new ZodReadonly({
		type: "readonly",
		innerType
	});
}
const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
	$ZodCustom.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
	return /* @__PURE__ */ _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
	return /* @__PURE__ */ _superRefine(fn, params);
}
//#endregion
//#region node_modules/zod/v4/classic/compat.js
/** @deprecated Use the raw string literal codes instead, e.g. "invalid_type". */
const ZodIssueCode = {
	invalid_type: "invalid_type",
	too_big: "too_big",
	too_small: "too_small",
	invalid_format: "invalid_format",
	not_multiple_of: "not_multiple_of",
	unrecognized_keys: "unrecognized_keys",
	invalid_union: "invalid_union",
	invalid_key: "invalid_key",
	invalid_element: "invalid_element",
	invalid_value: "invalid_value",
	custom: "custom"
};
/** @deprecated Do not use. Stub definition, only included for zod-to-json-schema compatibility. */
var ZodFirstPartyTypeKind;
ZodFirstPartyTypeKind || (ZodFirstPartyTypeKind = {});
//#endregion
//#region node_modules/@nostrify/nostrify/dist/NSchema.js
var NSchema = class NSchema {
	/** Schema to validate Nostr hex IDs such as event IDs and pubkeys. */
	static id() {
		return string().regex(/^[0-9a-f]{64}$/);
	}
	/** Nostr event schema. */
	static event() {
		return object({
			id: NSchema.id(),
			kind: number().int().nonnegative().max(65535),
			pubkey: NSchema.id(),
			tags: string().array().array(),
			content: string(),
			created_at: number().int().nonnegative(),
			sig: string()
		});
	}
	/**
	* Nostr filter schema.
	*
	* Only NIP-01 keys (`ids`, `authors`, `kinds`, `since`, `until`, `limit`,
	* `search`) and `#`-prefixed tag filters are accepted. Any other keys will
	* cause parsing to fail; callers should strip application-specific fields
	* (e.g. `seenOn`) before validating.
	*/
	static filter() {
		const knownKeys = [
			"ids",
			"authors",
			"kinds",
			"since",
			"until",
			"limit",
			"search"
		];
		return object({
			kinds: number().int().nonnegative().max(65535).array().optional(),
			ids: NSchema.id().array().optional(),
			authors: NSchema.id().array().optional(),
			since: number().int().nonnegative().optional(),
			until: number().int().nonnegative().optional(),
			limit: number().int().nonnegative().optional(),
			search: string().optional()
		}).catchall(string().array()).superRefine((value, ctx) => {
			for (const key of Object.keys(value)) {
				if (knownKeys.includes(key)) continue;
				if (key.startsWith("#") && key.length >= 2) continue;
				ctx.addIssue({
					code: "custom",
					message: `Unrecognized filter key: "${key}"`,
					path: [key]
				});
			}
		}).transform((value) => value);
	}
	/**
	* Bech32 string.
	* @see https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki#bech32
	*/
	static bech32(prefix) {
		return string().regex(/^[\x21-\x7E]{1,83}1[023456789acdefghjklmnpqrstuvwxyz]{6,}$/).refine((value) => prefix ? value.startsWith(`${prefix}1`) : true, prefix ? { message: `Expected bech32 prefix "${prefix}1"` } : void 0);
	}
	/** WebSocket URL starting with `ws://` or `wss://`. */
	static relayUrl() {
		return url().regex(/^wss?:\/\//);
	}
	/** NIP-01 `EVENT` message from client to relay. */
	static clientEVENT() {
		return tuple([literal("EVENT"), NSchema.event()]);
	}
	/** NIP-01 `REQ` message from client to relay. */
	static clientREQ() {
		return tuple([literal("REQ"), string()]).rest(NSchema.filter());
	}
	/** NIP-45 `COUNT` message from client to relay. */
	static clientCOUNT() {
		return tuple([literal("COUNT"), string()]).rest(NSchema.filter());
	}
	/** NIP-01 `CLOSE` message from client to relay. */
	static clientCLOSE() {
		return tuple([literal("CLOSE"), string()]);
	}
	/** NIP-42 `AUTH` message from client to relay. */
	static clientAUTH() {
		return tuple([literal("AUTH"), NSchema.event()]);
	}
	/** NIP-01 message from client to relay. */
	static clientMsg() {
		return union([
			NSchema.clientEVENT(),
			NSchema.clientREQ(),
			NSchema.clientCOUNT(),
			NSchema.clientCLOSE(),
			NSchema.clientAUTH()
		]);
	}
	/** NIP-01 `EVENT` message from relay to client. */
	static relayEVENT() {
		return tuple([
			literal("EVENT"),
			string(),
			NSchema.event()
		]);
	}
	/** NIP-01 `OK` message from relay to client. */
	static relayOK() {
		return tuple([
			literal("OK"),
			NSchema.id(),
			boolean(),
			string()
		]);
	}
	/** NIP-01 `EOSE` message from relay to client. */
	static relayEOSE() {
		return tuple([literal("EOSE"), string()]);
	}
	/** NIP-01 `NOTICE` message from relay to client. */
	static relayNOTICE() {
		return tuple([literal("NOTICE"), string()]);
	}
	/** NIP-01 `CLOSED` message from relay to client. */
	static relayCLOSED() {
		return tuple([
			literal("CLOSED"),
			string(),
			string()
		]);
	}
	/** NIP-42 `AUTH` message from relay to client. */
	static relayAUTH() {
		return tuple([literal("AUTH"), string()]);
	}
	/** NIP-45 `COUNT` message from relay to client. */
	static relayCOUNT() {
		return tuple([
			literal("COUNT"),
			string(),
			object({
				count: number().int().nonnegative(),
				approximate: boolean().optional()
			})
		]);
	}
	/** NIP-01 message from relay to client. */
	static relayMsg() {
		return union([
			NSchema.relayEVENT(),
			NSchema.relayOK(),
			NSchema.relayEOSE(),
			NSchema.relayNOTICE(),
			NSchema.relayCLOSED(),
			NSchema.relayAUTH(),
			NSchema.relayCOUNT()
		]);
	}
	/** Kind 0 content schema. */
	static metadata() {
		return looseObject({
			about: string().optional().catch(void 0),
			banner: url().optional().catch(void 0),
			bot: boolean().optional().catch(void 0),
			display_name: string().optional().catch(void 0),
			lud06: NSchema.bech32("lnurl").optional().catch(void 0),
			lud16: email().optional().catch(void 0),
			name: string().optional().catch(void 0),
			nip05: email().optional().catch(void 0),
			picture: url().optional().catch(void 0),
			website: url().optional().catch(void 0)
		});
	}
	/** NIP-11 Relay Information Document schema. */
	static relayInfo() {
		return looseObject({
			name: string().optional().catch(void 0),
			description: string().optional().catch(void 0),
			banner: string().optional().catch(void 0),
			icon: string().optional().catch(void 0),
			pubkey: NSchema.id().optional().catch(void 0),
			self: NSchema.id().optional().catch(void 0),
			contact: string().optional().catch(void 0),
			supported_nips: number().int().nonnegative().array().optional().catch(void 0),
			software: string().optional().catch(void 0),
			version: string().optional().catch(void 0),
			terms_of_service: string().optional().catch(void 0),
			limitation: looseObject({
				max_message_length: number().int().nonnegative().optional().catch(void 0),
				max_subscriptions: number().int().nonnegative().optional().catch(void 0),
				max_filters: number().int().nonnegative().optional().catch(void 0),
				max_limit: number().int().nonnegative().optional().catch(void 0),
				max_subid_length: number().int().nonnegative().optional().catch(void 0),
				max_event_tags: number().int().nonnegative().optional().catch(void 0),
				max_content_length: number().int().nonnegative().optional().catch(void 0),
				min_pow_difficulty: number().int().nonnegative().optional().catch(void 0),
				auth_required: boolean().optional().catch(void 0),
				payment_required: boolean().optional().catch(void 0),
				restricted_writes: boolean().optional().catch(void 0),
				created_at_lower_limit: number().int().nonnegative().optional().catch(void 0),
				created_at_upper_limit: number().int().nonnegative().optional().catch(void 0),
				default_limit: number().int().nonnegative().optional().catch(void 0)
			}).optional().catch(void 0),
			retention: array(object({
				time: number().int().nullable(),
				count: number().int().nonnegative().optional(),
				kinds: number().int().nonnegative().array().optional()
			})).optional().catch(void 0),
			relay_countries: string().array().optional().catch(void 0),
			language_tags: string().array().optional().catch(void 0),
			tags: string().array().optional().catch(void 0),
			posting_policy: string().optional().catch(void 0),
			payments_url: string().optional().catch(void 0),
			fees: record(string(), array(object({
				amount: number(),
				unit: string(),
				period: number().int().nonnegative().optional(),
				kinds: number().int().nonnegative().array().optional()
			}))).optional().catch(void 0)
		});
	}
	/** NIP-46 request content schema. */
	static connectRequest() {
		return object({
			id: string(),
			method: string(),
			params: string().array()
		});
	}
	/** NIP-46 response content schema. */
	static connectResponse() {
		return object({
			id: string(),
			result: string(),
			error: string().optional()
		});
	}
	/**
	* Helper schema to parse a JSON string. It should then be piped into another schema. For example:
	*
	* ```ts
	* const event = NSchema.json().pipe(NSchema.event()).parse(data);
	* ```
	*/
	static json() {
		return string().transform((value, ctx) => {
			try {
				return JSON.parse(value);
			} catch {
				ctx.addIssue({
					code: ZodIssueCode.custom,
					message: "Invalid JSON"
				});
				return NEVER;
			}
		});
	}
};
//#endregion
//#region src/lib/nostrId.ts
/**
* Canonical validator for 32-byte Nostr identifiers — pubkeys and event ids.
*
* Backed by Nostrify's {@link NSchema.id} so the rest of the stack inherits
* any future tightening upstream (e.g. case rules or whitespace handling).
*
* Use this **at the parse layer** whenever a pubkey or event id is extracted
* from untrusted event content (tag values, JSON-parsed content, URL params)
* before it reaches `nip19.*Encode`, `nostr.query` filters, or React route
* params. Malformed hex of the wrong length throws "padded hex string
* expected" from `@noble/hashes` deep inside `nip19`, which crashes the
* rendering subtree.
*
* Returns a type guard narrowing to {@link HexId} — the false branch retains
* the input's original type, so existing `string` callers keep working.
*
* Prefer the {@link tryNpubEncode}/{@link tryNeventEncode}/{@link tryNaddrEncode}
* wrappers from `@/lib/safeNip19` for non-throwing encodes at the render site.
*/
function isNostrId(value) {
	return idSchema.safeParse(value).success;
}
const idSchema = NSchema.id();
//#endregion
//#region src/lib/nip34Project.ts
init_pure();
const NIP34_REPOSITORY_KIND = 30617;
const NIP34_PATCH_KIND = 1617;
const NIP34_PULL_REQUEST_KIND = 1618;
const NIP34_ISSUE_KIND = 1621;
const NIP34_STATUS_KINDS = [
	1630,
	1631,
	1632,
	1633
];
const MAX_REPO_IDENTIFIER_BYTES = 256;
function singleTag(event, name) {
	const values = event.tags.filter(([tag]) => tag === name);
	return values.length === 1 ? values[0][1] : void 0;
}
/** Decode and canonicalize an addressable NIP-34 repository pointer. */
function parseRepoNaddr(raw) {
	if (typeof raw !== "string" || utf8Len(raw) > 2048) return void 0;
	const value = raw.trim();
	if (!value) return void 0;
	try {
		const decoded = nip19_exports.decode(value);
		if (decoded.type !== "naddr" || decoded.data.kind !== 30617) return void 0;
		const owner = decoded.data.pubkey.toLowerCase();
		const identifier = decoded.data.identifier;
		if (!isNostrId(owner) || !identifier || utf8Len(identifier) > MAX_REPO_IDENTIFIER_BYTES) return void 0;
		const relays = capRelays(decoded.data.relays ?? []);
		return {
			owner,
			identifier,
			relays,
			coordinate: `${NIP34_REPOSITORY_KIND}:${owner}:${identifier}`,
			naddr: nip19_exports.naddrEncode({
				kind: NIP34_REPOSITORY_KIND,
				pubkey: owner,
				identifier,
				relays
			})
		};
	} catch {
		return;
	}
}
/** Strictly validate the repository announcement named by a trusted pointer. */
function parseRepositoryEvent(event, pointer) {
	if (event.kind !== 30617 || event.pubkey !== pointer.owner || singleTag(event, "d") !== pointer.identifier || !verifyEvent$2(event)) return void 0;
	return event;
}
/** NIP-34 uses one `maintainers` tag whose remaining values are pubkeys. */
function repositoryMaintainers(event, pointer) {
	const maintainers = new Set([pointer.owner]);
	for (const tag of event.tags.filter(([name]) => name === "maintainers")) for (const pubkey of tag.slice(1)) {
		if (maintainers.size >= 100) return maintainers;
		if (isNostrId(pubkey)) maintainers.add(pubkey.toLowerCase());
	}
	return maintainers;
}
/** Artifact relays declared by the repository announcement. */
function repositoryRelays(event) {
	return capRelays(event.tags.filter(([name]) => name === "relays").flatMap((tag) => tag.slice(1)));
}
function parseProjectArtifact(event, pointer) {
	if (![
		1617,
		1618,
		1621
	].includes(event.kind) || !verifyEvent$2(event)) return;
	const repoTags = event.tags.filter(([name]) => name === "a");
	if (repoTags.length !== 1 || repoTags[0][1] !== pointer.coordinate) return void 0;
	const subject = event.tags.find(([name]) => name === "subject")?.[1]?.trim() || (event.kind === 1621 ? "Untitled issue" : event.kind === 1618 ? "Pull request" : "Patch");
	return {
		event,
		kind: event.kind,
		subject,
		labels: event.tags.filter(([name, value]) => name === "t" && !!value).map(([, value]) => value),
		statusRoot: event.kind !== 1617 || event.tags.some(([name, value]) => name === "t" && value === "root")
	};
}
const STATUS_NAMES = {
	1630: "open",
	1631: "applied",
	1632: "closed",
	1633: "draft"
};
/** Accept only a status rooted in one loaded artifact and signed by an
* authority NIP-34 recognizes: its author or a declared maintainer. */
function parseAuthoritativeStatus(event, artifacts, maintainers) {
	if (!NIP34_STATUS_KINDS.includes(event.kind) || !verifyEvent$2(event)) return void 0;
	const roots = event.tags.filter(([name, id, , marker]) => name === "e" && marker === "root" && isNostrId(id));
	if (roots.length !== 1) return void 0;
	const targetId = roots[0][1].toLowerCase();
	const target = artifacts.get(targetId);
	if (!target?.statusRoot || !maintainers.has(event.pubkey) && event.pubkey !== target.event.pubkey) return void 0;
	return {
		event,
		targetId,
		status: STATUS_NAMES[event.kind]
	};
}
/** Latest valid status per artifact; event id breaks equal-time relay order. */
function latestProjectStatuses(statuses) {
	const latest = /* @__PURE__ */ new Map();
	for (const status of statuses) {
		const prior = latest.get(status.targetId);
		if (!prior || status.event.created_at > prior.event.created_at || status.event.created_at === prior.event.created_at && status.event.id > prior.event.id) latest.set(status.targetId, status);
	}
	return latest;
}
//#endregion
//#region src/concord-v2/lib/orchestration.ts
/**
* Orchestration primitives (AGENT_CHAT_ORCHESTRATION.md §7/§14) — pure
* functions shared by the headless CLI, the MCP server, and (later) the UI
* manifest renderer. The claim tie-break MUST live in exactly one place or
* agents double-work: this is that place.
*
* Wire shapes:
* - Manifest: PUBLIC parameterized-replaceable kind 30078, tags
*   `["d", "orch-<id>"]`, `["t", "bao-orch"]`, content = JSON
*   {orch, goal, roles, tasks[]} — public even for sealed communities (the
*   manifest is coordination metadata, not community content).
* - Task lifecycle: chat messages (sealed rumors inside a ₿AO — inner kind 9)
*   tagged `["t", "orch-task"]` whose content starts with a verb:
*     CLAIM <taskId> key=<idempotencyKey> epoch=<fencingEpoch>
*     PROGRESS <taskId> <one line>
*     HANDOFF <taskId> @<agent> <state summary>   (receiver must ACK)
*     ACK <taskId>
*     DONE <taskId> <artifact refs>
*     BLOCKED <taskId> <reason> <need>
*   Machines parse the tags + first word; the rest stays human-readable.
*
* Fencing (mosaico daemon-design, adapted): every CLAIM carries a fencing
* epoch — the claimant's view of how many times the task has changed hands,
* plus one. A CLAIM whose epoch doesn't match current-epoch + 1 is a
* stale-view claim and is IGNORED (never half-succeed on a stale read): the
* loser re-resolves and retries at the right epoch. Two agents reclaiming the
* same stale claim publish the same epoch; the tie-break picks one, and the
* other detects the loss by re-resolving (`held` in chat-core) instead of
* double-working. Legacy CLAIMs without `epoch=` still claim (mixed fleet),
* and also bump the epoch. PROGRESS/DONE/BLOCKED stay claimant-scoped WITHOUT
* an epoch: resolution folds in ms order, so a zombie's late verb lands while
* someone else holds the claim and is ignored — same-author cross-epoch
* confusion can't survive the fold.
*/
const ORCH_TASK_TAG = "orch-task";
const VERBS = [
	"CLAIM",
	"PROGRESS",
	"HANDOFF",
	"ACK",
	"DONE",
	"BLOCKED"
];
/**
* Parse a chat message into a task-lifecycle message. Requires the
* `["t", "orch-task"]` tag AND a leading verb — either alone is not enough
* (a human typing "DONE deal!" in a tagged thread is not a state change).
*/
function parseTaskMessage(content, tags) {
	if (!tags.some((t) => t[0] === "t" && t[1] === "orch-task")) return null;
	const m = content.match(/^(\w+)\s+(\S+)(?:\s+([\s\S]*))?$/);
	if (!m) return null;
	const verb = m[1].toUpperCase();
	if (!VERBS.includes(verb)) return null;
	const rest = (m[3] ?? "").trim();
	const keyMatch = rest.match(/(?:^|\s)key=(\S+)/);
	const epochMatch = rest.match(/(?:^|\s)epoch=(\d+)(?:\s|$)/);
	return {
		verb,
		taskId: m[2],
		rest,
		...verb === "CLAIM" && keyMatch ? { idemKey: keyMatch[1] } : {},
		...verb === "CLAIM" && epochMatch ? { epoch: Number(epochMatch[1]) } : {}
	};
}
/**
* Deterministic idempotency key for a claim: a retrying agent re-publishes
* the SAME claim event instead of racing itself (§14). The epoch salts the
* key, so a re-claim after a stale takeover is a NEW key (not deduped against
* the earlier claim) while a retry of the same epoch's claim stays idempotent.
*/
function deriveClaimKey(orchId, taskId, epoch = 1) {
	return bytesToHex$1(sha256(new TextEncoder().encode(`bao-orch:claim:${orchId}:${taskId}:${epoch}`))).slice(0, 32);
}
/**
* Resolve who owns each task right now. THE shared tie-break (§14):
* first valid CLAIM by timestamp, ties broken by lowest message id. A claim
* with no PROGRESS from its claimant for `ttlMs` is STALE: it stays visible
* but the next valid CLAIM takes the task (stale claims never win over a
* fresh one). DONE/BLOCKED are terminal-state markers from the claimant only
* (nobody can mark someone else's task done).
*
* Fencing: an epoch-bearing CLAIM is valid ONLY if its epoch is exactly
* current-epoch + 1 (or 1 for a never-claimed task) — a mismatched CLAIM was
* issued from a stale view and is ignored outright, so two concurrent
* reclaimers can never both believe they won. Epoch-less legacy CLAIMs skip
* the check but still bump the epoch.
*
* Delivery is at-least-once (a relay can resend a stored event on a new
* subscription), so the SAME rumor id is processed once: a replayed legacy
* CLAIM on an already-stale claim would otherwise re-take the task and bump
* the epoch a second time, silently un-fencing every later CLAIM (found by
* the seed-101 fuzz property: duplication must be a no-op).
*/
function resolveClaims(messages, opts) {
	const sorted = [...messages].sort((a, b) => a.ms - b.ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const states = /* @__PURE__ */ new Map();
	const delivered = /* @__PURE__ */ new Set();
	for (const { id, author, ms, msg } of sorted) {
		if (delivered.has(id)) continue;
		delivered.add(id);
		if (ms - opts.nowMs > 9e5) continue;
		const cur = states.get(msg.taskId);
		switch (msg.verb) {
			case "CLAIM": {
				if (cur && !cur.stale && !cur.done && !cur.released) break;
				const nextEpoch = (cur?.epoch ?? 0) + 1;
				if (msg.epoch !== void 0 && msg.epoch !== nextEpoch) break;
				states.set(msg.taskId, {
					taskId: msg.taskId,
					claimant: author,
					claimId: id,
					claimMs: ms,
					lastProgressMs: ms,
					epoch: nextEpoch,
					done: false,
					blocked: false,
					released: false,
					stale: opts.nowMs - ms > opts.ttlMs
				});
				break;
			}
			case "PROGRESS":
				if (cur && cur.claimant === author && !cur.done) {
					cur.lastProgressMs = ms;
					cur.stale = false;
					cur.blocked = false;
				}
				break;
			case "DONE":
				if (cur && cur.claimant === author) {
					cur.done = true;
					cur.blocked = false;
					cur.lastProgressMs = ms;
				}
				break;
			case "BLOCKED":
				if (cur && cur.claimant === author && !cur.done) {
					cur.blocked = true;
					cur.lastProgressMs = ms;
				}
				break;
			case "HANDOFF":
				if (cur && cur.claimant === author && !cur.done) {
					cur.released = true;
					cur.lastProgressMs = ms;
				}
				break;
			case "ACK": break;
		}
	}
	for (const s of states.values()) if (!s.done && opts.nowMs - s.lastProgressMs > opts.ttlMs) s.stale = true;
	return states;
}
/**
* Executor-side fence check (mosaico: validate before acting, not only at
* claim time). May this author post this verb, given the resolved state?
*
* - CLAIM: always allowed to ATTEMPT — the fence arbitrates at resolve.
* - PROGRESS/DONE/BLOCKED while someone ELSE holds the claim: refused. The
*   resolver would ignore the zombie's verb anyway, but the refusal tells the
*   AGENT it lost — otherwise it posts DONE and walks away believing it
*   finished work it no longer owns. Own claim (even stale) may still be
*   refreshed or marked: staleness is a lease lapse, not a loss.
* - HANDOFF while someone else holds the claim: refused (only the claimant
*   can release). ACK carries no claim semantics, always allowed.
*/
function mayPostVerb(cur, author, verb) {
	if (verb === "PROGRESS" || verb === "DONE" || verb === "BLOCKED" || verb === "HANDOFF") {
		if (cur && cur.claimant !== author) return false;
	}
	return true;
}
/**
* Client-side mention detection (the sealed-stack interrupt): a message
* mentions me if it p-tags my pubkey, embeds my npub, or leads with my name.
* Relay-side #p filters cannot see inside sealed wraps — every agent scans
* post-decrypt (AGENT_CHAT_ORCHESTRATION.md §11.3, adapted for Concord).
* Content-based name matching is a HINT only (spoofable) — callers treating
* mentions as instructions must check the p-tag/npub forms.
*/
function mentionsMe(opts) {
	if (opts.tags.some((t) => t[0] === "p" && t[1] === opts.myPubkey)) return true;
	if (opts.content.includes(opts.myNpub)) return true;
	const lower = opts.content.toLowerCase();
	return opts.myNames.some((n) => n && (lower.includes(`@${n.toLowerCase()}`) || lower.startsWith(`${n.toLowerCase()}:`)));
}
//#endregion
//#region scripts/chat-core.ts
/**
* Shared chat-core for Concord V2 (₿AO) agents — consumed by BOTH the
* headless CLI (scripts/bao-agent.ts) and the MCP server
* (scripts/bao-chat-mcp.ts). One implementation of idempotent send, the
* mention interrupt, and claim resolution, so the two front-ends can never
* diverge.
*
* IMPORTANT: everything here logs to STDERR only. The MCP server speaks
* JSON-RPC on stdout; a stray stdout write corrupts the protocol stream.
*/
init_pure();
const STATE_DIR = join(homedir(), ".concord-live");
/** Keep identity-controlled filenames inside STATE_DIR. */
function validateIdentityName(name) {
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) throw new Error("Identity name must be 1–64 ASCII letters, digits, dots, underscores, or dashes, starting with a letter or digit.");
	return name;
}
function statePath(name) {
	return join(STATE_DIR, `${validateIdentityName(name)}.json`);
}
function loadState(name) {
	const path = statePath(name);
	if (!existsSync(path)) throw new Error(`No identity "${name}" — expected ${path}`);
	const state = JSON.parse(readFileSync(path, "utf8"));
	if ((state.protocol_version ?? 1) > 1) throw new Error(`Identity "${name}" was written by protocol v${state.protocol_version} but this binary speaks v1 — re-fetch bao-agent.mjs (never half-run a stale binary).`);
	return migrateState(state);
}
const HEX_32 = /^[0-9a-f]{64}$/i;
function validEpoch(value) {
	return Number.isSafeInteger(value) && value >= 0;
}
/**
* Upgrade and canonicalize the access portion of an on-disk identity without
* mutating the parsed object. Pre-retained-root states remain readable: their
* current root becomes the sole held root at runtime. An unknown legacy join
* time stays unknown so a future watcher cannot mistake old history for a kick.
*/
function migrateSavedCommunityAccess(community) {
	if (!validEpoch(community.root_epoch)) throw new Error("Saved community root_epoch must be a non-negative safe integer.");
	if (!HEX_32.test(community.community_root)) throw new Error("Saved community_root must be 32-byte hex.");
	const currentKey = community.community_root.toLowerCase();
	if (community.joined_at !== void 0 && !validEpoch(community.joined_at)) throw new Error("Saved community joined_at must be a non-negative safe millisecond timestamp.");
	const roots = /* @__PURE__ */ new Map();
	for (const held of community.held_roots ?? []) {
		if (!validEpoch(held.epoch) || !HEX_32.test(held.key)) throw new Error("Saved community retained roots must contain a non-negative safe epoch and 32-byte hex key.");
		if (held.epoch > community.root_epoch) throw new Error(`Saved community retained root epoch ${held.epoch} is newer than current epoch ${community.root_epoch}.`);
		if (held.epoch === community.root_epoch) {
			if (held.key.toLowerCase() !== currentKey) throw new Error("Saved community has conflicting keys for its current root epoch.");
			continue;
		}
		const key = held.key.toLowerCase();
		const prior = roots.get(held.epoch);
		if (prior !== void 0 && prior !== key) throw new Error(`Saved community has conflicting keys for retained root epoch ${held.epoch}.`);
		roots.set(held.epoch, key);
	}
	return {
		...community,
		community_root: currentKey,
		held_roots: [...roots].sort(([a], [b]) => b - a).map(([epoch, key]) => ({
			epoch,
			key
		})),
		...community.joined_at !== void 0 ? { joined_at: community.joined_at } : {},
		...community.refounder && HEX_32.test(community.refounder) ? { refounder: community.refounder.toLowerCase() } : { refounder: void 0 }
	};
}
/** Pure whole-state migration used by loadState and tests. */
function migrateState(state) {
	return {
		...state,
		community: migrateSavedCommunityAccess(state.community)
	};
}
/**
* Atomic write: crash mid-write must never leave a truncated state file —
* it holds the hex private key, and losing it orphans the identity (mosaico
* daemon-design, adopted as-is). tmp + rename is atomic on POSIX same-dir.
*/
function saveState(name, state) {
	mkdirSync(STATE_DIR, { recursive: true });
	const path = statePath(name);
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, JSON.stringify(migrateState(state), null, 2), { mode: 384 });
	renameSync(tmp, path);
}
/**
* Advisory lockfile around state read-modify-write ops (invite, sweep):
* two concurrent CLI processes would otherwise each read the old file and
* lose the other's write — the mosaico multi-writer lesson at file level.
* Locks whose holder died are reclaimed after 30s by mtime.
*
* `lockSuffix` selects the lock: the default ".lock" guards the state file
* itself, while keyed sends use a PER-KEY suffix (".send-<hash>") so two
* processes racing the same idempotency key serialize their
* check-then-publish WITHOUT blocking unrelated sends or state ops.
*/
async function withStateLock(name, fn, lockSuffix = ".lock") {
	const lock = `${statePath(name)}${lockSuffix}`;
	const deadline = Date.now() + 1e4;
	mkdirSync(STATE_DIR, { recursive: true });
	for (;;) try {
		closeSync(openSync(lock, "wx"));
		break;
	} catch (err) {
		if (err.code !== "EEXIST") throw err;
		try {
			if (Date.now() - statSync(lock).mtimeMs > 3e4) unlinkSync(lock);
		} catch {}
		if (Date.now() > deadline) throw new Error(`State for "${name}" is locked by another process (${lockSuffix}) — retry shortly.`);
		await new Promise((r) => setTimeout(r, 100));
	}
	try {
		return await fn();
	} finally {
		try {
			unlinkSync(lock);
		} catch {}
	}
}
function communityOf(c, privateChannels) {
	const saved = migrateSavedCommunityAccess(c);
	const root = hexToBytes$1(saved.community_root);
	const heldRoots = [{
		epoch: BigInt(saved.root_epoch),
		key: root
	}, ...(saved.held_roots ?? []).map((held) => ({
		epoch: BigInt(held.epoch),
		key: hexToBytes$1(held.key)
	}))];
	return {
		id: hexToBytes$1(saved.id),
		idHex: saved.id,
		owner: saved.owner,
		ownerSalt: hexToBytes$1(saved.owner_salt),
		root,
		rootEpoch: BigInt(saved.root_epoch),
		heldRoots,
		privateChannels: privateChannels.map((ch) => ({
			id: hexToBytes$1(ch.id),
			key: hexToBytes$1(ch.key),
			epoch: BigInt(ch.epoch),
			name: ch.name
		})),
		relays: saved.relays,
		name: saved.name,
		refounder: saved.refounder
	};
}
let pool = null;
/** One pool per process (the MCP server is long-lived; the CLI closes it on exit). */
function getPool() {
	pool ??= new SimplePool();
	return pool;
}
function closePool(relays) {
	pool?.close(relays);
}
function signerOf(sk) {
	return { signEvent: async (template) => {
		const { finalizeEvent } = await Promise.resolve().then(() => (init_pure(), pure_exports));
		return finalizeEvent(template, sk);
	} };
}
/** Publish to every home relay; throw only if NONE accept. */
async function publishAll(relays, event, label) {
	const results = await Promise.allSettled(getPool().publish(relays, event));
	const rejected = results.filter((r) => r.status === "rejected");
	if (rejected.length === results.length) {
		const reasons = rejected.map((r) => r.status === "rejected" ? String(r.reason) : "").join("; ");
		throw new Error(`no relay accepted ${label}: ${reasons}`);
	}
	const size = JSON.stringify(event).length;
	console.error(`  ✓ ${label}: kind ${event.kind} ${event.id.slice(0, 12)}… (${size} B) → ${results.length - rejected.length}/${results.length} relays`);
}
async function queryAll(relays, filter) {
	return getPool().querySync(relays, filter, { maxWait: 8e3 });
}
/** Fold current encrypted control metadata. No public project relay is touched. */
async function communityMetadata(state) {
	const community = communityOf(state.community, state.private_channels);
	const controls = controlGroups(community);
	return foldControlState(openControlWraps(await queryAll(community.relays, {
		kinds: [KIND_WRAP],
		authors: controls.map((control) => control.pk)
	}), controls), community.id, community.owner).metadata;
}
/**
* Read the public NIP-34 projection explicitly linked from sealed metadata.
* Calling this reveals interest in the repository to its hinted relays; chat
* and orchestration commands never call it implicitly.
*/
async function projectSnapshot(state) {
	const pointer = parseRepoNaddr((await communityMetadata(state))?.repo_naddr);
	if (!pointer) throw new Error("This community has no valid NIP-34 project attached.");
	const discoveryRelays = pointer.relays.length ? pointer.relays : state.community.relays;
	const repository = (await queryAll(discoveryRelays, {
		kinds: [30617],
		authors: [pointer.owner],
		"#d": [pointer.identifier],
		limit: 10
	})).map((event) => parseRepositoryEvent(event, pointer)).filter((event) => !!event).sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0];
	if (!repository) throw new Error("The attached NIP-34 repository announcement was not found or failed validation.");
	const maintainers = repositoryMaintainers(repository, pointer);
	const relays = repositoryRelays(repository);
	const sourceRelays = relays.length ? relays : discoveryRelays;
	const events = await queryAll(sourceRelays, {
		kinds: [
			NIP34_ISSUE_KIND,
			NIP34_PATCH_KIND,
			NIP34_PULL_REQUEST_KIND
		],
		"#a": [pointer.coordinate],
		limit: 300
	});
	const artifacts = events.map((event) => parseProjectArtifact(event, pointer)).filter((item) => !!item);
	const byId = new Map(artifacts.map((item) => [item.event.id, item]));
	const roots = artifacts.filter((item) => item.statusRoot);
	const statuses = latestProjectStatuses((roots.length ? await queryAll(sourceRelays, {
		kinds: [...NIP34_STATUS_KINDS],
		authors: [...new Set([...maintainers, ...roots.map((item) => item.event.pubkey)])],
		"#e": roots.map((item) => item.event.id),
		limit: Math.min(500, Math.max(1, roots.length * 4))
	}) : []).map((event) => parseAuthoritativeStatus(event, byId, maintainers)).filter((status) => !!status));
	const serialize = (kind) => artifacts.filter((item) => item.kind === kind).map((item) => ({
		id: item.event.id,
		author: item.event.pubkey,
		subject: item.subject,
		labels: item.labels,
		status: statuses.get(item.event.id)?.status,
		created_at: item.event.created_at
	})).sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
	return {
		coordinate: pointer.coordinate,
		naddr: pointer.naddr,
		name: repository.tags.find(([name]) => name === "name")?.[1] || pointer.identifier,
		description: repository.tags.find(([name]) => name === "description")?.[1],
		maintainers: [...maintainers],
		relays: sourceRelays,
		issues: serialize(NIP34_ISSUE_KIND),
		pull_requests: serialize(NIP34_PULL_REQUEST_KIND),
		patches: serialize(NIP34_PATCH_KIND),
		partial: events.length >= 300
	};
}
/** Public channels from the control fold + this identity's private channels. */
async function listChannels(state) {
	return (await availableChannels(state)).map((channel) => ({
		id: channel.idHex,
		name: channel.name,
		private: channel.isPrivate,
		epoch: Number(channel.current.epoch)
	}));
}
async function availableChannels(state) {
	const community = communityOf(state.community, state.private_channels);
	const controls = controlGroups(community);
	return channelsView(community, foldControlState(openControlWraps(await queryAll(community.relays, {
		kinds: [KIND_WRAP],
		authors: controls.map((control) => control.pk)
	}), controls), community.id, community.owner));
}
/** Resolve a channel by exact id or case-insensitive exact name. */
async function resolveChannel(state, selector) {
	const savedGeneral = state.community.general_channel_id?.toLowerCase();
	const requested = selector?.trim();
	const savedGeneralRequested = !!savedGeneral && (!requested || requested.toLowerCase() === "general" || requested.toLowerCase() === savedGeneral);
	let channels;
	try {
		channels = await availableChannels(state);
	} catch (error) {
		if (!savedGeneralRequested) throw error;
		const community = communityOf(state.community, state.private_channels);
		const id = hexToBytes$1(savedGeneral);
		const streams = community.heldRoots.map((root) => ({
			epoch: root.epoch,
			group: channelGroupKey(root.key, id, root.epoch)
		}));
		return {
			id,
			idHex: savedGeneral,
			name: "general",
			isPrivate: false,
			streams,
			current: streams[0],
			voice: {
				room: voiceGroupKey(community.root, id, community.rootEpoch),
				mediaKey: voiceMediaKey(community.root, id, community.rootEpoch)
			}
		};
	}
	let matches;
	if (selector) {
		const needle = selector.trim();
		matches = /^[0-9a-f]{64}$/i.test(needle) ? channels.filter((channel) => channel.idHex === needle.toLowerCase()) : channels.filter((channel) => channel.name.toLowerCase() === needle.toLowerCase());
	} else {
		const preferred = state.community.general_channel_id?.toLowerCase();
		matches = preferred ? channels.filter((channel) => channel.idHex === preferred) : [];
		if (matches.length === 0) matches = channels.filter((channel) => !channel.isPrivate && channel.name.toLowerCase() === "general");
		if (matches.length === 0) matches = channels.filter((channel) => !channel.isPrivate).slice(0, 1);
	}
	if (matches.length === 1) return matches[0];
	if (matches.length > 1) throw new Error(`Channel name ${JSON.stringify(selector)} is ambiguous; use its 64-hex id.`);
	const available = channels.map((channel) => `${channel.name} (${channel.idHex})`).join(", ");
	throw new Error(`Channel ${JSON.stringify(selector ?? "general")} not found.${available ? ` Available: ${available}` : ""}`);
}
/** Everything a channel operation needs, resolved once. */
async function channelContext(state, selector) {
	const sk = hexToBytes$1(state.sk);
	return {
		sk,
		pubkey: getPublicKey$1(sk),
		signer: signerOf(sk),
		community: communityOf(state.community, state.private_channels),
		channel: await resolveChannel(state, selector)
	};
}
/** Decrypted #general history (the relay only ever sees ciphertext). */
async function channelMessages(state, selector) {
	const { community, channel } = await channelContext(state, selector);
	const streams = new Map(channel.streams.map((stream) => [stream.group.pk, stream]));
	const wraps = await queryAll(community.relays, {
		kinds: [KIND_WRAP],
		authors: [...streams.keys()]
	});
	const messages = [];
	const seenWraps = /* @__PURE__ */ new Set();
	for (const wrap of wraps) {
		if (seenWraps.has(wrap.id)) continue;
		seenWraps.add(wrap.id);
		const stream = streams.get(wrap.pubkey);
		if (!stream) continue;
		try {
			const opened = openWrap(wrap, stream.group);
			if (opened.sealKind !== 20013) continue;
			checkChannelBinding(opened, channel.idHex, stream.epoch);
			if (opened.kind !== 9) continue;
			messages.push({
				id: opened.rumorId,
				author: opened.author,
				ms: opened.ms,
				content: opened.content,
				tags: opened.tags
			});
		} catch {}
	}
	messages.sort((a, b) => a.ms - b.ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const seenKeys = /* @__PURE__ */ new Set();
	return messages.filter((m) => {
		const d = m.tags.find((t) => t[0] === "d")?.[1];
		if (d === void 0) return true;
		const k = `${m.author}:${d}`;
		if (seenKeys.has(k)) return false;
		seenKeys.add(k);
		return true;
	});
}
/**
* Post to #general. Idempotent when `idemKey` is given: the key rides as a
* ["d", key] tag on the rumor, and a retry first scans our own history — if
* the key already landed, we report deduped instead of double-posting
* (AGENT_CHAT_ORCHESTRATION.md §14: machines retry, humans shouldn't see it).
*
* Deliberately NOT a durable outbox (mosaico's submit_intents): both
* front-ends are interactive request/response, so a crash before publish
* surfaces to the operator and a crash after publish is healed by the d-tag
* retry. Revisit if agents start unattended loops or money-adjacent verbs —
* at that point intents must survive the process.
*/
/**
* In-flight keyed sends serialize PER PROCESS: the idempotency scan below is
* check-then-publish and not atomic, and concurrent callers in one process
* (parallel MCP tool calls) would otherwise both scan before either lands and
* double-post (found live in the round-7 MCP stress). The waiter re-scans
* after the first send resolves and dedupes against it.
*
* The PER-PROCESS map alone leaves a CLI×CLI hole: two processes retrying the
* same key both scan before either publishes and double-post (round 10). So a
* keyed send additionally takes a per-key lockfile — the check-then-publish is
* then atomic across processes for that key. A contender that waits out the
* 10s deadline FAILS CLOSED with "locked by another process" instead of
* double-posting; the read-side (author, d-tag) dedupe remains as belt-and-
* braces for lock-free writers (older builds, other front-ends).
*/
const inflightKeyedSends = /* @__PURE__ */ new Map();
/** Per-key lockfile suffix for cross-process keyed-send serialization. */
function sendLockSuffix(idemKey) {
	return `.send-${bytesToHex$1(sha256(new TextEncoder().encode(idemKey))).slice(0, 16)}.lock`;
}
async function sendChannelMessage(state, text, opts = {}) {
	if (opts.idemKey) {
		const prior = inflightKeyedSends.get(opts.idemKey);
		if (prior) await prior.catch(() => {});
	}
	const run = opts.idemKey ? withStateLock(getPublicKey$1(hexToBytes$1(state.sk)), () => sendChannelMessageInner(state, text, opts), sendLockSuffix(opts.idemKey)) : sendChannelMessageInner(state, text, opts);
	if (!opts.idemKey) return run;
	inflightKeyedSends.set(opts.idemKey, run);
	try {
		return await run;
	} finally {
		if (inflightKeyedSends.get(opts.idemKey) === run) inflightKeyedSends.delete(opts.idemKey);
	}
}
async function sendChannelMessageInner(state, text, opts = {}) {
	const textBytes = new TextEncoder().encode(text).length;
	if (textBytes > 4e4) throw new Error(`Message too large: ${textBytes} bytes (max 40,000 — the sealed wrap must fit NIP-44's 65,535-byte plaintext cap)`);
	const { pubkey, signer, community, channel } = await channelContext(state, opts.channel);
	const group = channel.current.group;
	if (opts.idemKey) {
		const dupe = (await channelMessages(state, opts.channel)).find((m) => m.author === pubkey && m.tags.some((t) => t[0] === "d" && t[1] === opts.idemKey));
		if (dupe) return {
			rumorId: dupe.id,
			deduped: true
		};
	}
	const tags = [...channelBindingTags(channel.idHex, channel.current.epoch), ...opts.extraTags ?? []];
	if (opts.idemKey) tags.push(["d", opts.idemKey]);
	for (const match of text.match(/npub1[02-9ac-hj-np-z]{20,}/g) ?? []) try {
		const decoded = decode$2(match);
		if (decoded.type === "npub") tags.push(["p", decoded.data]);
	} catch {}
	const rumor = buildRumor({
		kind: 9,
		content: text,
		tags,
		pubkey,
		ms: Date.now()
	});
	const wrap = wrapSeal(await sealRumor(rumor, KIND_SEAL_ENCRYPTED, group, signer), group);
	await publishAll(community.relays, wrap, `message to #${channel.name}`);
	return {
		rumorId: rumor.id,
		deduped: false
	};
}
/**
* The mention interrupt (AGENT_CHAT_ORCHESTRATION.md §11.3, adapted for the
* sealed stack: a relay-side #p filter cannot see inside gift wraps, so we
* subscribe the channel's wraps by stream author and scan mentions
* post-decrypt). Resolves on the first NEW message mentioning the identity
* (default) or any new message. Timeout resolves `null` — a sentinel, never
* an error. Long-lived callers (MCP) must NOT close the shared pool here.
*/
async function waitForInterrupt(identityName, state, opts) {
	const { pubkey, community, channel } = await channelContext(state, opts.channel);
	const streams = new Map(channel.streams.map((stream) => [stream.group.pk, stream]));
	const myNpub = npubEncode$1(pubkey);
	const seen = /* @__PURE__ */ new Set();
	for (const w of await queryAll(community.relays, {
		kinds: [KIND_WRAP],
		authors: [...streams.keys()]
	})) seen.add(w.id);
	console.error(`listening on #${channel.name} of "${community.name}" (timeout ${opts.timeoutSec}s${opts.mentionsOnly ? ", mentions only" : ""})…`);
	return new Promise((resolve) => {
		let sub = null;
		const finish = (msg) => {
			clearTimeout(timer);
			sub?.close();
			resolve(msg);
		};
		const timer = setTimeout(() => finish(null), opts.timeoutSec * 1e3);
		sub = getPool().subscribeMany(community.relays, {
			kinds: [KIND_WRAP],
			authors: [...streams.keys()],
			since: Math.floor(Date.now() / 1e3) - 30
		}, { onevent(wrap) {
			if (seen.has(wrap.id)) return;
			seen.add(wrap.id);
			let opened;
			try {
				const stream = streams.get(wrap.pubkey);
				if (!stream) return;
				opened = openWrap(wrap, stream.group);
				if (opened.sealKind !== 20013) return;
				checkChannelBinding(opened, channel.idHex, stream.epoch);
			} catch {
				return;
			}
			if (opened.kind !== 9) return;
			if (opened.author === pubkey) return;
			const msg = {
				id: opened.rumorId,
				author: opened.author,
				ms: opened.ms,
				content: opened.content,
				tags: opened.tags
			};
			if (opts.mentionsOnly && !mentionsMe({
				tags: msg.tags,
				content: msg.content,
				myPubkey: pubkey,
				myNpub,
				myNames: [identityName]
			})) return;
			finish(msg);
		} });
	});
}
/**
* Publish a kind-0 profile announcing this identity's name. Names are
* enforced room-wide (the web join path refuses nameless keys; chat renders
* them anon-<npub8>) — so join/create publish the identity name up front.
* bot:true marks the key as an agent per the orchestration conventions.
*/
async function publishAgentProfile(sk, name, relays) {
	const { finalizeEvent } = await Promise.resolve().then(() => (init_pure(), pure_exports));
	await publishAll(relays, finalizeEvent({
		kind: 0,
		content: JSON.stringify({
			name,
			bot: true
		}),
		tags: [],
		created_at: Math.floor(Date.now() / 1e3)
	}, sk), "kind-0 profile (name)");
}
/** A claim with no PROGRESS from its claimant for this long is reclaimable.
*  BAO_CLAIM_TTL_MS overrides for live tests against a local relay. */
const CLAIM_TTL_MS = Number(process.env.BAO_CLAIM_TTL_MS ?? 1800 * 1e3);
/**
* Wait this long before DECLARING a claim held, then re-resolve. A claim that
* appears to win on a PARTIAL view — a rival's earlier-ms claim still in
* flight — flips to held=false on this confirmation pass instead of letting
* both racers believe they won (read-your-writes is not read-their-writes).
* BAO_CLAIM_SETTLE_MS overrides for live tests.
*/
const CLAIM_SETTLE_MS = Number(process.env.BAO_CLAIM_SETTLE_MS ?? 1500);
/**
* Fail-closed (mosaico daemon-design: "an unavailable control channel fails
* closed"). An empty claim history means one of two very different things —
* "no claims yet" or "the relays are down and we can't see the claims". Only
* the first may proceed; the second must throw, or an agent would read
* silence as claimable and double-work a live claim.
*
* Probes ACTIVELY (ensureRelay), not via listConnectionStatus: the status map
* is keyed by normalized URL and only reflects past connections, so a passive
* read both misses keys and can't run before the first query.
*/
async function assertRelayReachable(relays) {
	if ((await Promise.allSettled(relays.map((r) => getPool().ensureRelay(r, { connectionTimeout: 2500 })))).filter((p) => p.status === "fulfilled").length === 0) throw new Error(`cannot resolve claims: 0/${relays.length} relays reachable — refusing to treat silence as claimable (fail-closed). Retry when a relay answers.`);
}
async function orchVerbPost(state, verb, taskId, text, orchId) {
	if (/\s/.test(taskId)) throw new Error(`Task id must not contain whitespace: ${JSON.stringify(taskId)}`);
	if (verb === "CLAIM") {
		const myPubkey = getPublicKey$1(hexToBytes$1(state.sk));
		const cur = (await orchStates(state, orchId)).get(taskId);
		if (cur && !cur.stale && !cur.done && !cur.released) return {
			rumorId: cur.claimant === myPubkey ? cur.claimId : "",
			deduped: false,
			held: cur.claimant === myPubkey,
			epoch: cur.epoch
		};
		const epoch = (cur?.epoch ?? 0) + 1;
		const key = deriveClaimKey(orchId, taskId, epoch);
		let content = `CLAIM ${taskId} key=${key} epoch=${epoch}`;
		if (text) content += ` ${text}`;
		const sent = await sendChannelMessage(state, content, {
			idemKey: key,
			extraTags: [["t", ORCH_TASK_TAG], ["o", orchId]]
		});
		const holdsUs = (s) => !!s && s.claimant === myPubkey && s.epoch === epoch;
		let now = (await orchStates(state, orchId)).get(taskId);
		if (holdsUs(now) || !now) {
			await new Promise((r) => setTimeout(r, CLAIM_SETTLE_MS));
			now = (await orchStates(state, orchId)).get(taskId);
		}
		if (!now) return {
			...sent,
			held: null,
			epoch
		};
		return {
			...sent,
			held: holdsUs(now),
			epoch
		};
	}
	const myPubkey = getPublicKey$1(hexToBytes$1(state.sk));
	const cur = (await orchStates(state, orchId)).get(taskId);
	if (!mayPostVerb(cur, myPubkey, verb)) return {
		rumorId: "",
		deduped: false,
		held: false,
		epoch: cur?.epoch
	};
	const extraTags = [["t", ORCH_TASK_TAG], ["o", orchId]];
	return sendChannelMessage(state, `${verb} ${taskId}${text ? ` ${text}` : ""}`, { extraTags });
}
async function orchStates(state, orchId) {
	await assertRelayReachable(state.community.relays);
	const inputs = [];
	const messages = await channelMessages(state);
	for (const m of messages) {
		const msg = parseTaskMessage(m.content, m.tags);
		if (!msg) continue;
		const oTags = m.tags.filter((t) => t[0] === "o").map((t) => t[1]);
		if (oTags.length > 0 && !oTags.includes(orchId)) continue;
		inputs.push({
			id: m.id,
			author: m.author,
			ms: m.ms,
			msg
		});
	}
	return resolveClaims(inputs, {
		ttlMs: CLAIM_TTL_MS,
		nowMs: Date.now()
	});
}
//#endregion
//#region scripts/bao-agent.ts
/**
* Headless Concord V2 (₿AO) driver — the agent API entry (see AGENTS.md).
*
* A Claude session (or any agent) can create a ₿AO, mint invite links, join
* via one, and read/post in any channel — no GUI, straight onto the relays.
* State lives in ~/.concord-live/<name>.json (OUTSIDE the repo: it holds a
* private key) so an identity survives reboots and later sessions can re-enter.
*
* Channel operations (idempotent send, history, the mention interrupt, task
* claims) live in scripts/chat-core.ts — shared with the MCP server so the
* two front-ends can never diverge. This file is community lifecycle + CLI.
*
* Build: node_modules/.bin/rolldown -c scripts/rolldown.bao-agent.config.mjs
* Run:   node .tmp/bao-agent.mjs <mode> [args]
*
* Modes:
*   create [--name "…"] [--agent-only]   genesis + first invite, saves owner state
*   invite [--label L] [--single-use]    mint another invite link (owner state)
*   join <invite-url> [--as name]        join with a FRESH key, saves member state
*                                        (grinds the agent_gate PoW + checks
*                                        single-use spend automatically)
*   say <text> [--channel C] [--key K]   post to a channel (default #general;
*                                        a retry with the same key dedupes)
*   read [--channel C] [--json]          print a channel timeline + member list
*   wait [--channel C] [--timeout S]     interrupt: first NEW message mentioning
*                                        me (default) or any new message (--all).
*                                        Exit 0 = message, 2 = timeout.
*   orch show [--orch id] [--as name]    resolved task claims (shared tie-break)
*   orch claim|progress|done|blocked <taskId> [text] [--orch id] [--as name]
*   whoami [--as name]                   print the identity's npub
*
* Exit codes: 0 ok · 1 error · 2 timeout/no-result (Buzz-style discipline).
*/
init_pure();
const HOME_RELAYS = (process.env.BAO_RELAYS ?? "wss://relay.bao.network").split(",");
const ORIGINS = ["https://2140.wtf", "http://localhost:3500"];
async function create(name, communityName, agentOnly) {
	if (existsSync(statePath(name))) throw new Error(`Identity "${name}" already exists — use invite/say/read.`);
	const sk = generateSecretKey$1();
	const pubkey = getPublicKey$1(sk);
	const signer = signerOf(sk);
	const { community, generalChannelId } = mintCommunity(communityName, pubkey, HOME_RELAYS);
	console.log(`Creating "${communityName}" (${community.idHex.slice(0, 16)}…) on ${HOME_RELAYS.join(", ")}${agentOnly ? " — AGENT-ONLY" : ""}`);
	await publishAll(community.relays, await sealEdition(buildMetadataEdition(community.id, {
		name: communityName,
		relays: community.relays,
		...agentOnly ? { [AGENT_GATE_METADATA_KEY]: {
			type: "pow",
			difficulty: 20
		} } : {}
	}, {
		actorPubkey: pubkey,
		version: 1n
	}), currentControlGroup(community), signer), "metadata edition");
	await publishAll(community.relays, await sealEdition(buildChannelEdition(generalChannelId, {
		name: "general",
		private: false
	}, {
		actorPubkey: pubkey,
		version: 1n
	}), currentControlGroup(community), signer), "#general channel edition");
	await publishAll(community.relays, await sealGuestbook(agentOnly ? grindJoinRumor(pubkey, Date.now(), 20) : buildJoinRumor(pubkey, Date.now()), currentGuestbookGroup(community), signer), "founder join");
	saveState(name, {
		sk: bytesToHex$1(sk),
		role: "owner",
		community: {
			id: community.idHex,
			owner: pubkey,
			owner_salt: bytesToHex$1(community.ownerSalt),
			community_root: bytesToHex$1(community.root),
			root_epoch: Number(community.rootEpoch),
			held_roots: [],
			joined_at: Date.now(),
			name: communityName,
			relays: community.relays,
			general_channel_id: bytesToHex$1(generalChannelId)
		},
		private_channels: [],
		invites: [],
		registry_version: 0,
		protocol_version: 1
	});
	await publishAgentProfile(sk, name, community.relays);
	console.log(`\nOwner identity "${name}": ${npubEncode$1(pubkey)}`);
	console.log(`State: ${statePath(name)}\n`);
	await invite(name);
}
async function invite(name, label, singleUse = false) {
	await withStateLock(name, async () => {
		const state = loadState(name);
		if (state.role !== "owner") throw new Error("Only the owner identity can mint invites.");
		const sk = hexToBytes$1(state.sk);
		const pubkey = getPublicKey$1(sk);
		const signer = signerOf(sk);
		const community = communityOf(state.community, state.private_channels);
		const token = mintToken();
		const link = mintLinkSigner();
		const bundleEvent = buildBundleEvent({
			community_id: community.idHex,
			owner: community.owner,
			owner_salt: bytesToHex$1(community.ownerSalt),
			community_root: bytesToHex$1(community.root),
			root_epoch: Number(community.rootEpoch),
			channels: [],
			relays: community.relays,
			name: community.name,
			creator_npub: pubkey,
			...label ? { label } : {},
			...singleUse ? { max_uses: 1 } : {}
		}, token, link.sk);
		await publishAll(community.relays, bundleEvent, `invite bundle${singleUse ? " (single-use)" : ""}`);
		state.registry_version += 1;
		await publishAll(community.relays, await sealEdition(buildRegistryEdition(community.id, pubkey, state.invites.map((i) => i.link_pk).concat(link.pk), {
			actorPubkey: pubkey,
			version: BigInt(state.registry_version)
		}), currentControlGroup(community), signer), "invite registry edition");
		const urls = ORIGINS.map((origin) => buildInviteUrl(origin, link.pk, token, community.relays));
		state.invites.push({
			token: bytesToHex$1(token),
			link_sk: bytesToHex$1(link.sk),
			link_pk: link.pk,
			url: urls[0],
			created_at: Math.floor(Date.now() / 1e3),
			...singleUse ? { max_uses: 1 } : {}
		});
		saveState(name, state);
		console.log(`\nInvite link minted${label ? ` ("${label}")` : ""}${singleUse ? " — SINGLE-USE, dies after the first join" : ""} — share EITHER origin (same secret):`);
		for (const url of urls) console.log(`  ${url}`);
	});
}
async function joinBao(name, inviteUrl) {
	if (existsSync(statePath(name))) throw new Error(`Identity "${name}" already exists — use say/read.`);
	const parsed = parseInviteLink(inviteUrl.trim());
	if (!parsed) throw new Error("Not a recognizable invite link.");
	const events = await queryAll(parsed.bootstrapRelays, {
		kinds: [KIND_INVITE_BUNDLE],
		authors: [parsed.linkSigner],
		"#d": [""]
	});
	const ts = (e) => e.created_at;
	const maxTs = events.reduce((m, e) => Math.max(m, ts(e)), 0);
	const atMax = events.filter((e) => ts(e) === maxTs);
	const newest = atMax.find((e) => e.tags.some((t) => t[0] === "vsk" && t[1] === "9")) ?? atMax[0];
	if (!newest) throw new Error("Couldn't find that invite on its relays.");
	const bundle = parseBundleEvent(newest, parsed.linkSigner, parsed.token, Date.now());
	const sk = generateSecretKey$1();
	const pubkey = getPublicKey$1(sk);
	const signer = signerOf(sk);
	const community = communityOf({
		id: bundle.community_id,
		owner: bundle.owner,
		owner_salt: bundle.owner_salt,
		community_root: bundle.community_root,
		root_epoch: bundle.root_epoch,
		name: bundle.name,
		relays: bundle.relays
	}, bundle.channels);
	const control = currentControlGroup(community);
	const gate = agentGateOf(foldControlState(openControlWraps(await queryAll(community.relays, {
		kinds: [KIND_WRAP],
		authors: [control.pk]
	}), [control]), community.id, community.owner).metadata);
	if (gate) console.log(`  agent_gate detected (pow, difficulty ${gate.difficulty}) — grinding…`);
	const commitment = inviteCommitment(parsed.token);
	if (bundle.max_uses === 1) {
		const gb = currentGuestbookGroup(community);
		if (singleUseLinkUsed(openGuestbookOpened(openGuestbookWraps(await queryAll(community.relays, {
			kinds: [1059],
			authors: [gb.pk]
		}), [gb])), commitment)) throw new Error("That invite link was single-use and has already been used. Ask for a fresh one.");
	}
	const attribution = {
		creator: bundle.creator_npub ?? "",
		...bundle.label ? { label: bundle.label } : {},
		commitment
	};
	const joinedAt = Date.now();
	const rumor = gate ? grindJoinRumor(pubkey, joinedAt, gate.difficulty, attribution) : buildJoinRumor(pubkey, joinedAt, attribution);
	await publishAll(community.relays, await sealGuestbook(rumor, currentGuestbookGroup(community), signer), gate ? `guestbook join (pow ≥ ${gate.difficulty})` : "guestbook join");
	if (bundle.max_uses === 1) {
		const gb = currentGuestbookGroup(community);
		const myMs = resolveMs(rumor.created_at, rumor.tags);
		const earlierJoinWins = async () => {
			const rival = openGuestbookOpened(openGuestbookWraps(await queryAll(community.relays, {
				kinds: [KIND_WRAP],
				authors: [gb.pk]
			}), [gb])).filter((ev) => joinCommitmentOf(ev) === commitment).map((ev) => ({
				ms: ev.ms,
				id: ev.rumorId
			})).sort((a, b) => a.ms - b.ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
			return rival !== void 0 && (rival.ms < myMs || rival.ms === myMs && rival.id < rumor.id);
		};
		let lost = await earlierJoinWins();
		if (!lost) {
			await new Promise((r) => setTimeout(r, 1500));
			lost = await earlierJoinWins();
		}
		if (lost) {
			console.error("  ✗ That single-use link was spent by a CONCURRENT join (earlier Join on the guestbook) — you are NOT a member. Ask for a fresh link.");
			process.exitCode = 2;
			return;
		}
	}
	saveState(name, {
		sk: bytesToHex$1(sk),
		role: "member",
		community: {
			id: bundle.community_id,
			owner: bundle.owner,
			owner_salt: bundle.owner_salt,
			community_root: bundle.community_root,
			root_epoch: bundle.root_epoch,
			held_roots: [],
			joined_at: Date.now(),
			name: bundle.name,
			relays: bundle.relays
		},
		private_channels: bundle.channels,
		invites: [],
		registry_version: 0,
		protocol_version: 1
	});
	await publishAgentProfile(sk, name, community.relays);
	console.log(`\nJoined "${bundle.name}" as "${name}": ${npubEncode$1(pubkey)}`);
	console.log(`State: ${statePath(name)}`);
}
async function say(name, text, idemKey, channelSelector, json) {
	const state = loadState(name);
	const channel = await resolveChannel(state, channelSelector);
	const { rumorId, deduped } = await sendChannelMessage(state, text, {
		idemKey,
		channel: channel.idHex
	});
	if (json) console.log(JSON.stringify({
		rumor_id: rumorId,
		deduped,
		channel: {
			id: channel.idHex,
			name: channel.name,
			private: channel.isPrivate,
			epoch: Number(channel.current.epoch)
		}
	}));
	else if (deduped) console.log(`  ⓘ --key ${idemKey} already sent (rumor ${rumorId.slice(0, 12)}…) — deduped`);
}
async function read(name, channelSelector, json) {
	const state = loadState(name);
	const community = communityOf(state.community, state.private_channels);
	const channel = await resolveChannel(state, channelSelector);
	const messages = await channelMessages(state, channel.idHex);
	const gb = currentGuestbookGroup(community);
	const gbWraps = await queryAll(community.relays, {
		kinds: [KIND_WRAP],
		authors: [gb.pk]
	});
	const members = /* @__PURE__ */ new Map();
	for (const wrap of gbWraps.sort((a, b) => a.created_at - b.created_at)) try {
		const opened = openWrap(wrap, gb);
		if (opened.kind === 3306) members.set(opened.author, opened.content);
	} catch {}
	if (json) {
		console.log(JSON.stringify({
			community: community.name,
			channel: {
				id: channel.idHex,
				name: channel.name,
				private: channel.isPrivate,
				epoch: Number(channel.current.epoch)
			},
			channels: await listChannels(state),
			messages: messages.map((m) => ({
				id: m.id,
				author: m.author,
				author_npub: npubEncode$1(m.author),
				ms: m.ms,
				content: m.content,
				tags: m.tags
			})),
			members: [...members].map(([pk, status]) => ({
				pubkey: pk,
				npub: npubEncode$1(pk),
				status
			}))
		}, null, 2));
		return;
	}
	console.log(`\n#${channel.name} — ${messages.length} message(s):`);
	for (const m of messages) {
		const time = new Date(m.ms).toISOString().replace("T", " ").slice(0, 19);
		console.log(`  [${time}] ${npubEncode$1(m.author).slice(0, 16)}…: ${m.content}`);
	}
	console.log(`\nMembers (${[...members.values()].filter((s) => s === "join").length}):`);
	for (const [pk, status] of members) console.log(`  ${npubEncode$1(pk)} — ${status}`);
	if (state.role === "owner") await withStateLock(name, async () => {
		const fresh = loadState(name);
		const opened = openGuestbookOpened(openGuestbookWraps(gbWraps, [gb]));
		const spent = fresh.invites.filter((inv) => inv.max_uses === 1 && singleUseLinkUsed(opened, inviteCommitment(hexToBytes$1(inv.token))));
		if (spent.length === 0) return;
		const remaining = fresh.invites.filter((inv) => !spent.includes(inv));
		const sk = hexToBytes$1(fresh.sk);
		const signer = signerOf(sk);
		for (const inv of spent) {
			await publishAll(community.relays, buildRevocationEvent(hexToBytes$1(inv.link_sk)), `single-use tombstone (${inv.url.slice(0, 60)}…)`);
			console.log(`  ⓘ single-use link spent${inv.label ? ` ("${inv.label}")` : ""} — auto-revoked`);
		}
		fresh.registry_version += 1;
		await publishAll(community.relays, await sealEdition(buildRegistryEdition(community.id, getPublicKey$1(sk), remaining.map((i) => i.link_pk), {
			actorPubkey: getPublicKey$1(sk),
			version: BigInt(fresh.registry_version)
		}), currentControlGroup(community), signer), "invite registry edition");
		fresh.invites = remaining;
		saveState(name, fresh);
	});
}
async function waitMode(name, opts) {
	const state = loadState(name);
	const channel = await resolveChannel(state, opts.channel);
	const hit = await waitForInterrupt(name, state, {
		...opts,
		channel: channel.idHex
	});
	if (!hit) {
		if (opts.json) console.log(JSON.stringify({
			timeout: true,
			channel: {
				id: channel.idHex,
				name: channel.name
			}
		}));
		else console.log("(timeout — no matching message)");
		process.exitCode = 2;
		return;
	}
	if (opts.json) console.log(JSON.stringify({
		timeout: false,
		channel: {
			id: channel.idHex,
			name: channel.name
		},
		id: hit.id,
		author: hit.author,
		author_npub: npubEncode$1(hit.author),
		ms: hit.ms,
		content: hit.content,
		tags: hit.tags
	}));
	else {
		const time = new Date(hit.ms).toISOString().replace("T", " ").slice(0, 19);
		console.log(`[${time}] ${npubEncode$1(hit.author).slice(0, 16)}…: ${hit.content}`);
	}
}
async function orchVerb(name, verb, taskId, text, orchId) {
	const { rumorId, deduped, held, epoch } = await orchVerbPost(loadState(name), verb, taskId, text, orchId);
	if (verb === "CLAIM") {
		if (held === true) console.log(`  ✓ CLAIM ${taskId} held at epoch ${epoch} (rumor ${rumorId.slice(0, 12)}…${deduped ? ", deduped retry" : ""})`);
		else if (held === null) {
			console.log(`  ? CLAIM ${taskId} published at epoch ${epoch} but not visible yet — re-check: orch show --orch ${orchId}`);
			process.exitCode = 2;
		} else {
			console.log(`  ✗ CLAIM ${taskId} NOT held — another claimant won (epoch ${epoch}). Do NOT work this task.`);
			process.exitCode = 2;
		}
		return;
	}
	if (held === false) {
		console.log(`  ✗ ${verb} ${taskId} refused — task held by another claimant (epoch ${epoch}). Do NOT work this task.`);
		process.exitCode = 2;
		return;
	}
	if (deduped) console.log(`  ⓘ ${verb} ${taskId} already posted — deduped`);
}
async function orchShow(name, orchId, json) {
	const states = await orchStates(loadState(name), orchId);
	if (json) {
		console.log(JSON.stringify({
			orch: orchId,
			ttl_ms: CLAIM_TTL_MS,
			tasks: [...states.values()].map((s) => ({
				...s,
				claimant_npub: npubEncode$1(s.claimant)
			}))
		}, null, 2));
		return;
	}
	if (states.size === 0) {
		console.log(`orch "${orchId}": no task messages found`);
		process.exitCode = 2;
		return;
	}
	console.log(`\norch "${orchId}" — ${states.size} task(s):`);
	for (const s of states.values()) {
		const status = s.done ? "DONE" : s.released ? "HANDED OFF (reclaimable)" : s.blocked ? "BLOCKED" : s.stale ? "STALE (reclaimable)" : "claimed";
		console.log(`  ${s.taskId}: ${status} — ${npubEncode$1(s.claimant).slice(0, 16)}… (epoch ${s.epoch}, claim ${s.claimId.slice(0, 8)}…, last activity ${new Date(s.lastProgressMs).toISOString()})`);
	}
}
function argValue(args, flag) {
	const i = args.indexOf(flag);
	return i >= 0 ? args[i + 1] : void 0;
}
/** Flags whose NEXT token is a value (not a positional arg). */
const VALUE_FLAGS = [
	"--as",
	"--key",
	"--orch",
	"--timeout",
	"--name",
	"--label",
	"--channel"
];
/** Positional args: everything that isn't a --flag or a value flag's value. */
function positionalArgs(args) {
	const out = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (VALUE_FLAGS.includes(a)) {
			i++;
			continue;
		}
		if (a.startsWith("--")) continue;
		out.push(a);
	}
	return out;
}
async function main() {
	const [mode, ...rest] = process.argv.slice(2);
	const as = argValue(rest, "--as") ?? "owner";
	const json = rest.includes("--json");
	switch (mode) {
		case "create":
			await create(as, argValue(rest, "--name") ?? "₿AO agent hangout — live test", rest.includes("--agent-only"));
			break;
		case "invite":
			await invite(as, argValue(rest, "--label"), rest.includes("--single-use"));
			break;
		case "join": {
			const url = positionalArgs(rest)[0];
			if (!url) throw new Error("join needs an invite URL");
			await joinBao(as, url);
			break;
		}
		case "say": {
			const text = positionalArgs(rest).join(" ");
			if (!text) throw new Error("say needs text");
			await say(as, text, argValue(rest, "--key"), argValue(rest, "--channel"), json);
			break;
		}
		case "read":
			await read(as, argValue(rest, "--channel"), json);
			break;
		case "project": {
			const snapshot = await projectSnapshot(loadState(as));
			if (json) console.log(JSON.stringify(snapshot));
			else {
				console.log(`\n${snapshot.name} — ${snapshot.coordinate}`);
				if (snapshot.description) console.log(snapshot.description);
				console.log(`  ${snapshot.issues.length} issue(s), ${snapshot.pull_requests.length} pull request(s), ${snapshot.patches.length} patch(es)${snapshot.partial ? " (partial result; use a repository client for full history)" : ""}`);
				for (const issue of snapshot.issues) console.log(`  issue ${issue.id.slice(0, 12)}… [${issue.status ?? "unmarked"}] ${issue.subject}`);
				for (const pr of snapshot.pull_requests) console.log(`  PR    ${pr.id.slice(0, 12)}… [${pr.status ?? "unmarked"}] ${pr.subject}`);
			}
			break;
		}
		case "wait": {
			const timeoutSec = Number(argValue(rest, "--timeout") ?? "60");
			if (!Number.isFinite(timeoutSec) || timeoutSec < 1 || timeoutSec > 300) throw new Error("--timeout must be 1..300 seconds");
			await waitMode(as, {
				timeoutSec,
				mentionsOnly: !rest.includes("--all"),
				channel: argValue(rest, "--channel"),
				json
			});
			break;
		}
		case "orch": {
			const pos = positionalArgs(rest);
			const sub = pos[0];
			const orchId = argValue(rest, "--orch") ?? "cards";
			if (sub === "show") {
				await orchShow(as, orchId, json);
				break;
			}
			const verb = (sub ?? "").toUpperCase();
			if (![
				"CLAIM",
				"PROGRESS",
				"DONE",
				"BLOCKED",
				"ACK",
				"HANDOFF"
			].includes(verb)) throw new Error("orch needs: show | claim|progress|done|blocked|ack|handoff <taskId> [text]");
			const taskId = pos[1];
			if (!taskId) throw new Error(`orch ${sub} needs a taskId`);
			await orchVerb(as, verb, taskId, pos.slice(2).join(" "), orchId);
			break;
		}
		case "whoami": {
			const state = loadState(as);
			console.log(`${as}: ${npubEncode$1(getPublicKey$1(hexToBytes$1(state.sk)))} (${state.role} of ${state.community.name})`);
			break;
		}
		default: console.log("modes: create [--agent-only] | invite | join <url> | say <text> [--channel C] [--key K] | read [--channel C] [--json] | project [--json] | wait [--channel C] [--timeout S] [--all] | orch show|claim|progress|done|blocked|ack|handoff … | whoami   [--as identity] [--json]");
	}
}
main().catch((err) => {
	console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
	process.exitCode = 1;
}).finally(() => {
	closePool(HOME_RELAYS);
	setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
});
//#endregion
export {};
