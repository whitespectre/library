/*
 * Copyright 2010 ZXing authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import ResultPoint from '../../ResultPoint';
import AztecDetectorResult from '../AztecDetectorResult';
import CornerDetector from '../../common/detector/CornerDetector';
import MathUtils from '../../common/detector/MathUtils';
import WhiteRectangleDetector from '../../common/detector/WhiteRectangleDetector';
import GenericGF from '../../common/reedsolomon/GenericGF';
import ReedSolomonDecoder from '../../common/reedsolomon/ReedSolomonDecoder';
import NotFoundException from '../../NotFoundException';
import GridSamplerInstance from '../../common/GridSamplerInstance';
import Integer from '../../util/Integer';
export class Point {
    toResultPoint() {
        return new ResultPoint(this.getX(), this.getY());
    }
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    getX() {
        return this.x;
    }
    getY() {
        return this.y;
    }
}
/**
 * Encapsulates logic that can detect an Aztec Code in an image, even if the Aztec Code
 * is rotated or skewed, or partially obscured.
 *
 * @author David Olivier
 * @author Frank Yellin
 */
export default class Detector {
    constructor(image) {
        this.EXPECTED_CORNER_BITS = new Int32Array([
            0xee0,
            0x1dc,
            0x83b,
            0x707,
        ]);
        this.image = image;
    }
    detect() {
        return this.detectMirror(false);
    }
    /**
     * Detects an Aztec Code in an image.
     *
     * @param isMirror if true, image is a mirror-image of original
     * @return {@link AztecDetectorResult} encapsulating results of detecting an Aztec Code
     * @throws NotFoundException if no Aztec Code can be found
     */
    detectMirror(isMirror) {
        // 1. Get the center of the aztec matrix
        let pCenter = this.getMatrixCenter();
        // 2. Get the center points of the four diagonal points just outside the bull's eye
        //  [topRight, bottomRight, bottomLeft, topLeft]
        let bullsEyeCorners = this.getBullsEyeCorners(pCenter);
        if (isMirror) {
            let temp = bullsEyeCorners[0];
            bullsEyeCorners[0] = bullsEyeCorners[2];
            bullsEyeCorners[2] = temp;
        }
        // 3. Get the size of the matrix and other parameters from the bull's eye
        this.extractParameters(bullsEyeCorners);
        // 4. Get the corners of the matrix.
        let corners = this.getMatrixCornerPoints(pCenter, bullsEyeCorners, this.getDimension());
        // 5. Sample the grid
        let bits = this.sampleGrid(this.image, corners[(this.shift + 1) % 4], corners[(this.shift + 2) % 4], corners[(this.shift + 3) % 4], corners[this.shift % 4]);
        return new AztecDetectorResult(bits, corners, this.compact, this.nbDataBlocks, this.nbLayers);
    }
    /**
     * Extracts the number of data layers and data blocks from the layer around the bull's eye.
     *
     * @param bullsEyeCorners the array of bull's eye corners
     * @throws NotFoundException in case of too many errors or invalid parameters
     */
    extractParameters(bullsEyeCorners) {
        if (!this.isValidPoint(bullsEyeCorners[0]) || !this.isValidPoint(bullsEyeCorners[1]) ||
            !this.isValidPoint(bullsEyeCorners[2]) || !this.isValidPoint(bullsEyeCorners[3])) {
            throw new NotFoundException();
        }
        let length = 2 * this.nbCenterLayers;
        // Get the bits around the bull's eye
        let sides = new Int32Array([
            this.sampleLine(bullsEyeCorners[0], bullsEyeCorners[1], length),
            this.sampleLine(bullsEyeCorners[1], bullsEyeCorners[2], length),
            this.sampleLine(bullsEyeCorners[2], bullsEyeCorners[3], length),
            this.sampleLine(bullsEyeCorners[3], bullsEyeCorners[0], length) // Top
        ]);
        // bullsEyeCorners[shift] is the corner of the bulls'eye that has three
        // orientation marks.
        // sides[shift] is the row/column that goes from the corner with three
        // orientation marks to the corner with two.
        this.shift = this.getRotation(sides, length);
        // Flatten the parameter bits into a single 28- or 40-bit long
        let parameterData = 0;
        for (let i = 0; i < 4; i++) {
            let side = sides[(this.shift + i) % 4];
            if (this.compact) {
                // Each side of the form ..XXXXXXX. where Xs are parameter data
                parameterData <<= 7;
                parameterData += (side >> 1) & 0x7F;
            }
            else {
                // Each side of the form ..XXXXX.XXXXX. where Xs are parameter data
                parameterData <<= 10;
                parameterData += ((side >> 2) & (0x1f << 5)) + ((side >> 1) & 0x1F);
            }
        }
        // Corrects parameter data using RS.  Returns just the data portion
        // without the error correction.
        let correctedData = this.getCorrectedParameterData(parameterData, this.compact);
        if (this.compact) {
            // 8 bits:  2 bits layers and 6 bits data blocks
            this.nbLayers = (correctedData >> 6) + 1;
            this.nbDataBlocks = (correctedData & 0x3F) + 1;
        }
        else {
            // 16 bits:  5 bits layers and 11 bits data blocks
            this.nbLayers = (correctedData >> 11) + 1;
            this.nbDataBlocks = (correctedData & 0x7FF) + 1;
        }
    }
    getRotation(sides, length) {
        // In a normal pattern, we expect to See
        //   **    .*             D       A
        //   *      *
        //
        //   .      *
        //   ..    ..             C       B
        //
        // Grab the 3 bits from each of the sides the form the locator pattern and concatenate
        // into a 12-bit integer.  Start with the bit at A
        let cornerBits = 0;
        sides.forEach((side, idx, arr) => {
            // XX......X where X's are orientation marks
            let t = ((side >> (length - 2)) << 1) + (side & 1);
            cornerBits = (cornerBits << 3) + t;
        });
        // for (var side in sides) {
        //     // XX......X where X's are orientation marks
        //     var t = ((side >> (length - 2)) << 1) + (side & 1);
        //     cornerBits = (cornerBits << 3) + t;
        // }
        // Mov the bottom bit to the top, so that the three bits of the locator pattern at A are
        // together.  cornerBits is now:
        //  3 orientation bits at A || 3 orientation bits at B || ... || 3 orientation bits at D
        cornerBits = ((cornerBits & 1) << 11) + (cornerBits >> 1);
        // The result shift indicates which element of BullsEyeCorners[] goes into the top-left
        // corner. Since the four rotation values have a Hamming distance of 8, we
        // can easily tolerate two errors.
        for (let shift = 0; shift < 4; shift++) {
            if (Integer.bitCount(cornerBits ^ this.EXPECTED_CORNER_BITS[shift]) <= 2) {
                return shift;
            }
        }
        throw new NotFoundException();
    }
    /**
     * Corrects the parameter bits using Reed-Solomon algorithm.
     *
     * @param parameterData parameter bits
     * @param compact true if this is a compact Aztec code
     * @throws NotFoundException if the array contains too many errors
     */
    getCorrectedParameterData(parameterData, compact) {
        let numCodewords;
        let numDataCodewords;
        if (compact) {
            numCodewords = 7;
            numDataCodewords = 2;
        }
        else {
            numCodewords = 10;
            numDataCodewords = 4;
        }
        let numECCodewords = numCodewords - numDataCodewords;
        let parameterWords = new Int32Array(numCodewords);
        for (let i = numCodewords - 1; i >= 0; --i) {
            parameterWords[i] = parameterData & 0xF;
            parameterData >>= 4;
        }
        try {
            let rsDecoder = new ReedSolomonDecoder(GenericGF.AZTEC_PARAM);
            rsDecoder.decode(parameterWords, numECCodewords);
        }
        catch (ignored) {
            throw new NotFoundException();
        }
        // Toss the error correction.  Just return the data as an integer
        let result = 0;
        for (let i = 0; i < numDataCodewords; i++) {
            result = (result << 4) + parameterWords[i];
        }
        return result;
    }
    /**
     * Finds the corners of a bull-eye centered on the passed point.
     * This returns the centers of the diagonal points just outside the bull's eye
     * Returns [topRight, bottomRight, bottomLeft, topLeft]
     *
     * @param pCenter Center point
     * @return The corners of the bull-eye
     * @throws NotFoundException If no valid bull-eye can be found
     */
    getBullsEyeCorners(pCenter) {
        let corr_factor = 1.0;
        let pina = pCenter;
        let pinb = pCenter;
        let pinc = pCenter;
        let pind = pCenter;
        let color = true;
        for (this.nbCenterLayers = 1; this.nbCenterLayers < 9; this.nbCenterLayers++) {
            let corr_tmp;
            let pouta = this.getFirstDifferent(pina, color, 1, -1);
            let poutb = this.getFirstDifferent(pinb, color, 1, 1);
            let poutc = this.getFirstDifferent(pinc, color, -1, 1);
            let poutd = this.getFirstDifferent(pind, color, -1, -1);
            // d      a
            //
            // c      b
            if (this.nbCenterLayers > 2) {
                corr_tmp = Math.max(this.distancePoint(poutd, pouta) / (((this.nbCenterLayers * 2) - 1) * 2), 1.0);
                let q = this.distancePoint(poutd, pouta) * this.nbCenterLayers / (this.distancePoint(pind, pina) * (this.nbCenterLayers + 2));
                if (q < 0.75 || q > 1.25 || !this.isWhiteOrBlackRectangle(pouta, poutb, poutc, poutd, corr_tmp)) {
                    break;
                }
            }
            else {
                corr_tmp = corr_factor;
            }
            pina = pouta;
            pinb = poutb;
            pinc = poutc;
            pind = poutd;
            color = !color;
            corr_factor = corr_tmp;
        }
        if (this.nbCenterLayers !== 5 && this.nbCenterLayers !== 7) {
            throw new NotFoundException();
        }
        this.compact = this.nbCenterLayers === 5;
        // Expand the square by .5 pixel in each direction so that we're on the border
        // between the white square and the black square
        let pinax = new ResultPoint(pina.getX() + 0.5, pina.getY() - 0.5);
        let pinbx = new ResultPoint(pinb.getX() + 0.5, pinb.getY() + 0.5);
        let pincx = new ResultPoint(pinc.getX() - 0.5, pinc.getY() + 0.5);
        let pindx = new ResultPoint(pind.getX() - 0.5, pind.getY() - 0.5);
        // Expand the square so that its corners are the centers of the points
        // just outside the bull's eye.
        return this.expandSquare([pinax, pinbx, pincx, pindx], 2 * this.nbCenterLayers - 3, 2 * this.nbCenterLayers);
    }
    /**
     * Finds a candidate center point of an Aztec code from an image
     *
     * @return the center point
     */
    getMatrixCenter() {
        let pointA;
        let pointB;
        let pointC;
        let pointD;
        // Get a white rectangle that can be the border of the matrix in center bull's eye or
        try {
            let cornerPoints = new WhiteRectangleDetector(this.image).detect();
            pointA = cornerPoints[0];
            pointB = cornerPoints[1];
            pointC = cornerPoints[2];
            pointD = cornerPoints[3];
        }
        catch (e) {
            // This exception can be in case the initial rectangle is white
            // In that case, surely in the bull's eye, we try to expand the rectangle.
            let cx = this.image.getWidth() / 2;
            let cy = this.image.getHeight() / 2;
            pointA = this.getFirstDifferent(new Point(cx + 7, cy - 7), false, 1, -1).toResultPoint();
            pointB = this.getFirstDifferent(new Point(cx + 7, cy + 7), false, 1, 1).toResultPoint();
            pointC = this.getFirstDifferent(new Point(cx - 7, cy + 7), false, -1, 1).toResultPoint();
            pointD = this.getFirstDifferent(new Point(cx - 7, cy - 7), false, -1, -1).toResultPoint();
        }
        // Compute the center of the rectangle
        let cx = MathUtils.round((pointA.getX() + pointD.getX() + pointB.getX() + pointC.getX()) / 4.0);
        let cy = MathUtils.round((pointA.getY() + pointD.getY() + pointB.getY() + pointC.getY()) / 4.0);
        // Redetermine the white rectangle starting from previously computed center.
        // This will ensure that we end up with a white rectangle in center bull's eye
        // in order to compute a more accurate center.
        try {
            let cornerPoints = new WhiteRectangleDetector(this.image, 15, cx, cy).detect();
            pointA = cornerPoints[0];
            pointB = cornerPoints[1];
            pointC = cornerPoints[2];
            pointD = cornerPoints[3];
        }
        catch (e) {
            // This exception can be in case the initial rectangle is white
            // In that case we try to expand the rectangle.
            pointA = this.getFirstDifferent(new Point(cx + 7, cy - 7), false, 1, -1).toResultPoint();
            pointB = this.getFirstDifferent(new Point(cx + 7, cy + 7), false, 1, 1).toResultPoint();
            pointC = this.getFirstDifferent(new Point(cx - 7, cy + 7), false, -1, 1).toResultPoint();
            pointD = this.getFirstDifferent(new Point(cx - 7, cy - 7), false, -1, -1).toResultPoint();
        }
        // Recompute the center of the rectangle
        cx = MathUtils.round((pointA.getX() + pointD.getX() + pointB.getX() + pointC.getX()) / 4.0);
        cy = MathUtils.round((pointA.getY() + pointD.getY() + pointB.getY() + pointC.getY()) / 4.0);
        return new Point(cx, cy);
    }
    /**
     * Gets the Aztec code corners from the bull's eye corners and the parameters.
     *
     * @param bullsEyeCorners the array of bull's eye corners
     * @return the array of aztec code corners
     */
    getMatrixCornerPoints(pCenter, bullsEyeCorners, targetMatrixSize) {
        let maxX = 0.0;
        let minX = this.image.getWidth();
        bullsEyeCorners.forEach((bullsEyeCorner, idx, arr) => {
            let tmpX = bullsEyeCorner.getX();
            if (tmpX > maxX) {
                maxX = tmpX;
            }
            if (tmpX < minX) {
                minX = tmpX;
            }
        });
        // for (var bullsEyeCorner: ResultPoint in bullsEyeCorners) {
        //     var tmpX = bullsEyeCorner.getX();
        //     if (tmpX > maxX) {
        //         maxX = tmpX;
        //     }
        //     if (tmpX < minX) {
        //         minX = tmpX;
        //     }
        // }
        let initSize = maxX - minX; // we are looking for first white rectangle outside of bulls eye
        return (new CornerDetector(this.image, initSize, pCenter.getX(), pCenter.getY(), targetMatrixSize)).detect();
    }
    /**
     * Creates a BitMatrix by sampling the provided image.
     * topLeft, topRight, bottomRight, and bottomLeft are the centers of the squares on the
     * diagonal just outside the bull's eye.
     */
    sampleGrid(image, topLeft, topRight, bottomRight, bottomLeft) {
        let sampler = GridSamplerInstance.getInstance();
        let dimension = this.getDimension();
        let low = 0.5;
        let high = dimension - 0.5;
        return sampler.sampleGrid(image, dimension, dimension, low, low, // topleft
        high, low, // topright
        high, high, // bottomright
        low, high, // bottomleft
        topLeft.getX(), topLeft.getY(), topRight.getX(), topRight.getY(), bottomRight.getX(), bottomRight.getY(), bottomLeft.getX(), bottomLeft.getY());
    }
    /**
     * Samples a line.
     *
     * @param p1   start point (inclusive)
     * @param p2   end point (exclusive)
     * @param size number of bits
     * @return the array of bits as an int (first bit is high-order bit of result)
     */
    sampleLine(p1, p2, size) {
        let result = 0;
        let d = this.distanceResultPoint(p1, p2);
        let moduleSize = d / size;
        let px = p1.getX();
        let py = p1.getY();
        let dx = moduleSize * (p2.getX() - p1.getX()) / d;
        let dy = moduleSize * (p2.getY() - p1.getY()) / d;
        for (let i = 0; i < size; i++) {
            if (this.image.get(MathUtils.round(px + i * dx), MathUtils.round(py + i * dy))) {
                result |= 1 << (size - i - 1);
            }
        }
        return result;
    }
    /**
     * @return true if the border of the rectangle passed in parameter is compound of white points only
     *         or black points only
     */
    isWhiteOrBlackRectangle(p1, p2, p3, p4, corr) {
        p1 = new Point(p1.getX() - corr, p1.getY() + corr);
        p2 = new Point(p2.getX() - corr, p2.getY() - corr);
        p3 = new Point(p3.getX() + corr, p3.getY() - corr);
        p4 = new Point(p4.getX() + corr, p4.getY() + corr);
        let cInit = this.getColor(p4, p1);
        if (cInit === 0) {
            return false;
        }
        let c = this.getColor(p1, p2);
        if (c !== cInit) {
            return false;
        }
        c = this.getColor(p2, p3);
        if (c !== cInit) {
            return false;
        }
        c = this.getColor(p3, p4);
        return c === cInit;
    }
    /**
     * Gets the color of a segment
     *
     * @return 1 if segment more than 90% black, -1 if segment is more than 90% white, 0 else
     */
    getColor(p1, p2) {
        let d = this.distancePoint(p1, p2);
        let dx = (p2.getX() - p1.getX()) / d;
        let dy = (p2.getY() - p1.getY()) / d;
        let error = 0;
        let px = p1.getX();
        let py = p1.getY();
        let colorModel = this.image.get(p1.getX(), p1.getY());
        let iMax = Math.ceil(d);
        for (let i = 0; i < iMax; i++) {
            px += dx;
            py += dy;
            if (this.image.get(MathUtils.round(px), MathUtils.round(py)) !== colorModel) {
                error++;
            }
        }
        let errRatio = error / d;
        if (errRatio > 0.1 && errRatio < 0.9) {
            return 0;
        }
        return (errRatio <= 0.1) === colorModel ? 1 : -1;
    }
    /**
     * Gets the coordinate of the first point with a different color in the given direction
     */
    getFirstDifferent(init, color, dx, dy) {
        let x = init.getX() + dx;
        let y = init.getY() + dy;
        while (this.isValid(x, y) && this.image.get(x, y) === color) {
            x += dx;
            y += dy;
        }
        x -= dx;
        y -= dy;
        while (this.isValid(x, y) && this.image.get(x, y) === color) {
            x += dx;
        }
        x -= dx;
        while (this.isValid(x, y) && this.image.get(x, y) === color) {
            y += dy;
        }
        y -= dy;
        return new Point(x, y);
    }
    /**
     * Expand the square represented by the corner points by pushing out equally in all directions
     *
     * @param cornerPoints the corners of the square, which has the bull's eye at its center
     * @param oldSide the original length of the side of the square in the target bit matrix
     * @param newSide the new length of the size of the square in the target bit matrix
     * @return the corners of the expanded square
     */
    expandSquare(cornerPoints, oldSide, newSide) {
        let ratio = newSide / (2.0 * oldSide);
        let dx = cornerPoints[0].getX() - cornerPoints[2].getX();
        let dy = cornerPoints[0].getY() - cornerPoints[2].getY();
        let centerx = (cornerPoints[0].getX() + cornerPoints[2].getX()) / 2.0;
        let centery = (cornerPoints[0].getY() + cornerPoints[2].getY()) / 2.0;
        let result0 = new ResultPoint(centerx + ratio * dx, centery + ratio * dy);
        let result2 = new ResultPoint(centerx - ratio * dx, centery - ratio * dy);
        dx = cornerPoints[1].getX() - cornerPoints[3].getX();
        dy = cornerPoints[1].getY() - cornerPoints[3].getY();
        centerx = (cornerPoints[1].getX() + cornerPoints[3].getX()) / 2.0;
        centery = (cornerPoints[1].getY() + cornerPoints[3].getY()) / 2.0;
        let result1 = new ResultPoint(centerx + ratio * dx, centery + ratio * dy);
        let result3 = new ResultPoint(centerx - ratio * dx, centery - ratio * dy);
        let results = [result0, result1, result2, result3];
        return results;
    }
    isValid(x, y) {
        return x >= 0 && x < this.image.getWidth() && y > 0 && y < this.image.getHeight();
    }
    isValidPoint(point) {
        let x = MathUtils.round(point.getX());
        let y = MathUtils.round(point.getY());
        return this.isValid(x, y);
    }
    distancePoint(a, b) {
        return MathUtils.distance(a.getX(), a.getY(), b.getX(), b.getY());
    }
    distanceResultPoint(a, b) {
        return MathUtils.distance(a.getX(), a.getY(), b.getX(), b.getY());
    }
    getDimension() {
        if (this.compact) {
            return 4 * this.nbLayers + 11;
        }
        if (this.nbLayers <= 4) {
            return 4 * this.nbLayers + 15;
        }
        return 4 * this.nbLayers + 2 * ((this.nbLayers - 4) / 8 + 1) + 15;
    }
}
//# sourceMappingURL=Detector.js.map