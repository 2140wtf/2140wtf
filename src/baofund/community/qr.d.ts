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
export declare function generateQRCode(text: any, options?: {}): {
    moduleCount: number;
    isDark: (row: any, col: any) => boolean;
    toMatrix: () => boolean[][];
    toSVG: (cellSize?: number, margin?: number, colors?: {}) => string;
    toDataURL: (cellSize?: number, margin?: number, colors?: {}) => any;
};
