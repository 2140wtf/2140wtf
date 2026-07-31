import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __esmMin = (fn, res) => () => (fn && (res = fn(fn = 0)), res);
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
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
	finalizeEvent: () => finalizeEvent,
	generateSecretKey: () => generateSecretKey,
	getEventHash: () => getEventHash$1,
	getPublicKey: () => getPublicKey,
	serializeEvent: () => serializeEvent$1,
	sortEvents: () => sortEvents,
	validateEvent: () => validateEvent$1,
	verifiedSymbol: () => verifiedSymbol$1,
	verifyEvent: () => verifyEvent$1
});
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
function sortEvents(events) {
	return events.sort((a, b) => {
		if (a.created_at !== b.created_at) return b.created_at - a.created_at;
		return a.id.localeCompare(b.id);
	});
}
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
	return bytesToHex$2(sha256$1(utf8Encoder$3.encode(serializeEvent$1(event))));
}
var verifiedSymbol$1, isRecord$1, utf8Encoder$3, JS$1, i$1, generateSecretKey, getPublicKey, finalizeEvent, verifyEvent$1;
var init_pure = __esmMin((() => {
	init_secp256k1();
	init_utils$1();
	init_sha2();
	verifiedSymbol$1 = Symbol("verified");
	isRecord$1 = (obj) => obj instanceof Object;
	new TextDecoder("utf-8");
	utf8Encoder$3 = new TextEncoder();
	JS$1 = class {
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
	i$1 = new JS$1();
	generateSecretKey = i$1.generateSecretKey;
	getPublicKey = i$1.getPublicKey;
	finalizeEvent = i$1.finalizeEvent;
	verifyEvent$1 = i$1.verifyEvent;
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
const base64 = hasBase64Builtin ? {
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
var utf8Decoder$1 = new TextDecoder("utf-8");
var utf8Encoder$2 = new TextEncoder();
var Bech32MaxSize = 5e3;
function decode(code) {
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
					relays: tlv[1] ? tlv[1].map((d) => utf8Decoder$1.decode(d)) : []
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
					relays: tlv[1] ? tlv[1].map((d) => utf8Decoder$1.decode(d)) : [],
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
					identifier: utf8Decoder$1.decode(tlv[0][0]),
					pubkey: bytesToHex$2(tlv[2][0]),
					kind: parseInt(bytesToHex$2(tlv[3][0]), 16),
					relays: tlv[1] ? tlv[1].map((d) => utf8Decoder$1.decode(d)) : []
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
function npubEncode(hex) {
	return encodeBytes("npub", hexToBytes$2(hex));
}
function encodeBech32(prefix, data) {
	let words = bech32.toWords(data);
	return bech32.encode(prefix, words, Bech32MaxSize);
}
function encodeBytes(prefix, bytes) {
	return encodeBech32(prefix, bytes);
}
function naddrEncode(addr) {
	let kind = /* @__PURE__ */ new ArrayBuffer(4);
	new DataView(kind).setUint32(0, addr.kind, false);
	return encodeBech32("naddr", encodeTLV({
		0: [utf8Encoder$2.encode(addr.identifier)],
		1: (addr.relays || []).map((url) => utf8Encoder$2.encode(url)),
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
//#endregion
//#region node_modules/nostr-tools/lib/esm/pool.js
init_secp256k1();
init_utils$1();
init_sha2();
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
new TextDecoder("utf-8");
var utf8Encoder$1 = new TextEncoder();
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
	return bytesToHex$2(sha256$1(utf8Encoder$1.encode(serializeEvent(event))));
}
var i = new JS();
i.generateSecretKey;
i.getPublicKey;
i.finalizeEvent;
var verifyEvent = i.verifyEvent;
var ClientAuth = 22242;
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
function getHex64(json, field) {
	let len = field.length + 3;
	let idx = json.indexOf(`"${field}":`) + len;
	let s = json.slice(idx).indexOf(`"`) + idx + 1;
	return json.slice(s, s + 64);
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
function makeAuthEvent(relayURL, challenge) {
	return {
		kind: ClientAuth,
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
		this.url = normalizeURL(url);
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
				let evt = await signAuthEvent(makeAuthEvent(this.url, challenge));
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
		const subid = getSubscriptionId(json);
		if (subid) {
			const so = this.openSubs.get(subid);
			if (!so) return;
			const id = getHex64(json, "id");
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
	t[verifiedSymbol] = true;
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
		url = normalizeURL(url);
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
		relays.map(normalizeURL).forEach((url) => {
			this.relays.get(url)?.close();
			this.relays.delete(url);
		});
	}
	subscribe(relays, filter, params) {
		const request = [];
		const uniqUrls = [];
		for (let i2 = 0; i2 < relays.length; i2++) {
			const url = normalizeURL(relays[i2]);
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
		return relays.map(normalizeURL).map(async (url, i2, arr) => {
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
var _WebSocket;
try {
	_WebSocket = WebSocket;
} catch {}
var SimplePool = class extends AbstractSimplePool {
	constructor(options) {
		super({
			verifyEvent,
			websocketImplementation: _WebSocket,
			maxWaitForConnection: 3e3,
			...options
		});
	}
};
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
var utf8Decoder = new TextDecoder("utf-8");
var utf8Encoder = new TextEncoder();
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
		data = base64.decode(payload);
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
function encrypt(plaintext, conversationKey, nonce = randomBytes$2(32)) {
	const { chacha_key, chacha_nonce, hmac_key } = getMessageKeys(conversationKey, nonce);
	const ciphertext = chacha20(chacha_key, chacha_nonce, pad(plaintext));
	const mac = hmacAad(hmac_key, ciphertext, nonce);
	return base64.encode(concatBytes$2(new Uint8Array([2]), nonce, ciphertext, mac));
}
function decrypt(payload, conversationKey) {
	const { nonce, ciphertext, mac } = decodePayload(payload);
	const { chacha_key, chacha_nonce, hmac_key } = getMessageKeys(conversationKey, nonce);
	if (!equalBytes(hmacAad(hmac_key, ciphertext, nonce), mac)) throw new Error("invalid MAC");
	return unpad(chacha20(chacha_key, chacha_nonce, ciphertext));
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
		convKey: getConversationKey(sk, pk)
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
		if (typeof r !== "string" || !r) continue;
		const canonical = canonicalRelayUrl(r);
		if (seen.has(canonical)) continue;
		seen.add(canonical);
		out.push(canonical);
	}
	return out;
}
/** Byte length of a string as UTF-8. */
function utf8Len(s) {
	return new TextEncoder().encode(s).length;
}
/** Runtime check that a value is a plausible {@link ImagePointer}. */
function isImagePointer(v) {
	if (!v || typeof v !== "object") return false;
	const o = v;
	return typeof o.url === "string" && typeof o.key === "string" && typeof o.nonce === "string" && typeof o.hash === "string";
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
	return finalizeEvent({
		kind: KIND_INVITE_BUNDLE,
		content: encrypt(JSON.stringify(bundle), inviteBundleKey(token)),
		tags: [["d", ""], ["vsk", "6"]],
		created_at: Math.floor(Date.now() / 1e3)
	}, linkSignerSk);
}
/** Re-post the coordinate as a revocation tombstone (creator only — needs the signer). */
function buildRevocationEvent(linkSignerSk) {
	return finalizeEvent({
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
	if (event.kind !== 33301 || event.pubkey !== expectedSigner || !verifyEvent$1(event)) throw new InviteError("bad-bundle", "not a valid invite bundle event");
	const vsk = event.tags.find((t) => t[0] === "vsk")?.[1];
	if (vsk === "9") throw new InviteError("revoked", "this invite link has been revoked");
	if (vsk !== "6") throw new InviteError("bad-bundle", `unknown bundle marker: ${vsk}`);
	let bundle;
	try {
		bundle = JSON.parse(decrypt(event.content, inviteBundleKey(token)));
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
	return naddrEncode({
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
		const decoded = decode(naddr);
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
	const sk = generateSecretKey();
	return {
		sk,
		pk: getPublicKey(sk)
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
	return encrypt(plaintext, convKey);
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
		id: getEventHash$1(unsigned)
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
	const tags = [["p", getPublicKey(opts?.ephemeralSk ?? generateSecretKey())]];
	if (opts?.expirationAtSecs) tags.push(["expiration", String(opts.expirationAtSecs)]);
	return finalizeEvent({
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
		seal = JSON.parse(decrypt(wrap.content, stream.convKey));
	} catch (e) {
		throw new StreamError("decrypt", `wrap decrypt: ${e instanceof Error ? e.message : e}`);
	}
	if (seal.kind !== 20013 && seal.kind !== 20014) throw new StreamError("bad-seal-kind", `unknown seal kind ${seal.kind}`);
	if (!verifyEvent$1(seal)) throw new StreamError("bad-seal-signature", "seal signature invalid");
	let rumor;
	try {
		const json = seal.kind === 20013 ? decrypt(seal.content, stream.convKey) : seal.content;
		rumor = JSON.parse(json);
	} catch (e) {
		throw new StreamError(seal.kind === 20013 ? "decrypt" : "parse", `rumor recover: ${e instanceof Error ? e.message : e}`);
	}
	if (rumor.pubkey !== seal.pubkey) throw new StreamError("author-mismatch", "rumor author does not match the seal's signer");
	const expectedId = getEventHash$1({
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
		if (counter > 1 << 26) throw new Error(`proof-of-work grind exceeded safety cap at difficulty ${difficulty}`);
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
//#region scripts/bao-agent.ts
/**
* Headless Concord V2 (₿AO) driver — the agent API entry (see AGENTS.md).
*
* A Claude session (or any agent) can create a ₿AO, mint invite links, join
* via one, and read/post in #general — no GUI, straight onto the relays.
* State lives in ~/.concord-live/<name>.json (OUTSIDE the repo: it holds a
* private key) so an identity survives reboots and later sessions can re-enter.
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
*   say <text> [--as name]               post to #general
*   read [--as name]                     print #general timeline + member list
*   whoami [--as name]                   print the identity's npub
*/
init_pure();
const HOME_RELAYS = ["wss://relay.bao.network"];
const STATE_DIR = join(homedir(), ".concord-live");
const ORIGINS = ["https://2140.wtf", "http://localhost:3500"];
function statePath(name) {
	return join(STATE_DIR, `${name}.json`);
}
function loadState(name) {
	const path = statePath(name);
	if (!existsSync(path)) throw new Error(`No identity "${name}" — expected ${path}`);
	return JSON.parse(readFileSync(path, "utf8"));
}
function saveState(name, state) {
	mkdirSync(STATE_DIR, { recursive: true });
	writeFileSync(statePath(name), JSON.stringify(state, null, 2), { mode: 384 });
}
function communityOf(c, privateChannels) {
	const root = hexToBytes$1(c.community_root);
	return {
		id: hexToBytes$1(c.id),
		idHex: c.id,
		owner: c.owner,
		ownerSalt: hexToBytes$1(c.owner_salt),
		root,
		rootEpoch: BigInt(c.root_epoch),
		heldRoots: [{
			epoch: BigInt(c.root_epoch),
			key: root
		}],
		privateChannels: privateChannels.map((ch) => ({
			id: hexToBytes$1(ch.id),
			key: hexToBytes$1(ch.key),
			epoch: BigInt(ch.epoch),
			name: ch.name
		})),
		relays: c.relays,
		name: c.name
	};
}
const pool = new SimplePool();
function signerOf(sk) {
	return { signEvent: async (template) => {
		const { finalizeEvent } = await Promise.resolve().then(() => (init_pure(), pure_exports));
		return finalizeEvent(template, sk);
	} };
}
/** Publish to every home relay; throw only if NONE accept. */
async function publishAll(relays, event, label) {
	const results = await Promise.allSettled(pool.publish(relays, event));
	const rejected = results.filter((r) => r.status === "rejected");
	if (rejected.length === results.length) {
		const reasons = rejected.map((r) => r.status === "rejected" ? String(r.reason) : "").join("; ");
		throw new Error(`no relay accepted ${label}: ${reasons}`);
	}
	const size = JSON.stringify(event).length;
	console.log(`  ✓ ${label}: kind ${event.kind} ${event.id.slice(0, 12)}… (${size} B) → ${results.length - rejected.length}/${results.length} relays`);
}
async function queryAll(relays, filter) {
	return pool.querySync(relays, filter, { maxWait: 8e3 });
}
async function create(name, communityName, agentOnly) {
	if (existsSync(statePath(name))) throw new Error(`Identity "${name}" already exists — use invite/say/read.`);
	const sk = generateSecretKey();
	const pubkey = getPublicKey(sk);
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
			name: communityName,
			relays: community.relays,
			general_channel_id: bytesToHex$1(generalChannelId)
		},
		private_channels: [],
		invites: [],
		registry_version: 0
	});
	console.log(`\nOwner identity "${name}": ${npubEncode(pubkey)}`);
	console.log(`State: ${statePath(name)}\n`);
	await invite(name);
}
async function invite(name, label, singleUse = false) {
	const state = loadState(name);
	if (state.role !== "owner") throw new Error("Only the owner identity can mint invites.");
	const sk = hexToBytes$1(state.sk);
	const pubkey = getPublicKey(sk);
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
}
async function joinBao(name, inviteUrl) {
	if (existsSync(statePath(name))) throw new Error(`Identity "${name}" already exists — use say/read.`);
	const parsed = parseInviteLink(inviteUrl.trim());
	if (!parsed) throw new Error("Not a recognizable invite link.");
	const newest = (await queryAll(parsed.bootstrapRelays, {
		kinds: [KIND_INVITE_BUNDLE],
		authors: [parsed.linkSigner],
		"#d": [""],
		limit: 1
	})).sort((a, b) => b.created_at - a.created_at)[0];
	if (!newest) throw new Error("Couldn't find that invite on its relays.");
	const bundle = parseBundleEvent(newest, parsed.linkSigner, parsed.token, Date.now());
	const sk = generateSecretKey();
	const pubkey = getPublicKey(sk);
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
	const rumor = gate ? grindJoinRumor(pubkey, Date.now(), gate.difficulty, attribution) : buildJoinRumor(pubkey, Date.now(), attribution);
	await publishAll(community.relays, await sealGuestbook(rumor, currentGuestbookGroup(community), signer), gate ? `guestbook join (pow ≥ ${gate.difficulty})` : "guestbook join");
	saveState(name, {
		sk: bytesToHex$1(sk),
		role: "member",
		community: {
			id: bundle.community_id,
			owner: bundle.owner,
			owner_salt: bundle.owner_salt,
			community_root: bundle.community_root,
			root_epoch: bundle.root_epoch,
			name: bundle.name,
			relays: bundle.relays
		},
		private_channels: bundle.channels,
		invites: [],
		registry_version: 0
	});
	console.log(`\nJoined "${bundle.name}" as "${name}": ${npubEncode(pubkey)}`);
	console.log(`State: ${statePath(name)}`);
}
/** Resolve #general: owner's stored id, else fold the control plane. */
async function generalChannel(state) {
	if (state.community.general_channel_id) return {
		idHex: state.community.general_channel_id,
		id: hexToBytes$1(state.community.general_channel_id)
	};
	const community = communityOf(state.community, state.private_channels);
	const control = currentControlGroup(community);
	const folded = foldControlState(openControlWraps(await queryAll(community.relays, {
		kinds: [KIND_WRAP],
		authors: [control.pk]
	}), [control]), community.id, community.owner);
	for (const def of folded.channels.values()) if (!def.isPrivate && !def.deleted && def.name === "general") return {
		idHex: def.channelIdHex,
		id: hexToBytes$1(def.channelIdHex)
	};
	for (const def of folded.channels.values()) if (!def.isPrivate && !def.deleted) return {
		idHex: def.channelIdHex,
		id: hexToBytes$1(def.channelIdHex)
	};
	throw new Error("No public channel found in the control fold.");
}
async function say(name, text) {
	const state = loadState(name);
	const sk = hexToBytes$1(state.sk);
	const pubkey = getPublicKey(sk);
	const signer = signerOf(sk);
	const community = communityOf(state.community, state.private_channels);
	const channel = await generalChannel(state);
	const group = channelGroupKey(community.root, channel.id, 0n);
	const wrap = wrapSeal(await sealRumor(buildRumor({
		kind: 9,
		content: text,
		tags: channelBindingTags(channel.idHex, 0n),
		pubkey,
		ms: Date.now()
	}), KIND_SEAL_ENCRYPTED, group, signer), group);
	await publishAll(community.relays, wrap, `message to #general`);
}
async function read(name) {
	const state = loadState(name);
	const community = communityOf(state.community, state.private_channels);
	const channel = await generalChannel(state);
	const group = channelGroupKey(community.root, channel.id, 0n);
	const wraps = await queryAll(community.relays, {
		kinds: [KIND_WRAP],
		authors: [group.pk]
	});
	const messages = [];
	for (const wrap of wraps) try {
		const opened = openWrap(wrap, group);
		if (opened.kind !== 9) continue;
		messages.push({
			ms: opened.ms,
			author: opened.author,
			content: opened.content
		});
	} catch {}
	messages.sort((a, b) => a.ms - b.ms);
	console.log(`\n#general — ${messages.length} message(s):`);
	for (const m of messages) {
		const time = new Date(m.ms).toISOString().replace("T", " ").slice(0, 19);
		console.log(`  [${time}] ${npubEncode(m.author).slice(0, 16)}…: ${m.content}`);
	}
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
	console.log(`\nMembers (${[...members.values()].filter((s) => s === "join").length}):`);
	for (const [pk, status] of members) console.log(`  ${npubEncode(pk)} — ${status}`);
	if (state.role === "owner") {
		const opened = openGuestbookOpened(openGuestbookWraps(gbWraps, [gb]));
		const remaining = [];
		for (const inv of state.invites) {
			if (inv.max_uses !== 1) {
				remaining.push(inv);
				continue;
			}
			if (!singleUseLinkUsed(opened, inviteCommitment(hexToBytes$1(inv.token)))) {
				remaining.push(inv);
				continue;
			}
			const sk = hexToBytes$1(state.sk);
			const signer = signerOf(sk);
			await publishAll(community.relays, buildRevocationEvent(hexToBytes$1(inv.link_sk)), `single-use tombstone (${inv.url.slice(0, 60)}…)`);
			state.registry_version += 1;
			await publishAll(community.relays, await sealEdition(buildRegistryEdition(community.id, getPublicKey(sk), remaining.map((i) => i.link_pk), {
				actorPubkey: getPublicKey(sk),
				version: BigInt(state.registry_version)
			}), currentControlGroup(community), signer), "invite registry edition");
			console.log(`  ⓘ single-use link spent${inv.label ? ` ("${inv.label}")` : ""} — auto-revoked`);
		}
		if (remaining.length !== state.invites.length) {
			state.invites = remaining;
			saveState(name, state);
		}
	}
}
function argValue(args, flag) {
	const i = args.indexOf(flag);
	return i >= 0 ? args[i + 1] : void 0;
}
async function main() {
	const [mode, ...rest] = process.argv.slice(2);
	const as = argValue(rest, "--as") ?? "owner";
	switch (mode) {
		case "create":
			await create(as, argValue(rest, "--name") ?? "₿AO agent hangout — live test", rest.includes("--agent-only"));
			break;
		case "invite":
			await invite(as, argValue(rest, "--label"), rest.includes("--single-use"));
			break;
		case "join": {
			const url = rest.find((a) => !a.startsWith("--") && a !== as);
			if (!url) throw new Error("join needs an invite URL");
			await joinBao(as, url);
			break;
		}
		case "say": {
			const text = rest.filter((a) => !a.startsWith("--") && a !== as).join(" ");
			if (!text) throw new Error("say needs text");
			await say(as, text);
			break;
		}
		case "read":
			await read(as);
			break;
		case "whoami": {
			const state = loadState(as);
			console.log(`${as}: ${npubEncode(getPublicKey(hexToBytes$1(state.sk)))} (${state.role} of ${state.community.name})`);
			break;
		}
		default: console.log("modes: create [--agent-only] | invite | join <url> | say <text> | read | whoami   [--as identity]");
	}
}
main().catch((err) => {
	console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}`);
	process.exitCode = 1;
}).finally(() => {
	pool.close(HOME_RELAYS);
	setTimeout(() => process.exit(process.exitCode ?? 0), 500).unref();
});
//#endregion
export {};
