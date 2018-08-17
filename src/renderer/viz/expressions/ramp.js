import BaseExpression from './base';
import { implicitCast, checkLooseType, checkExpression, checkType, clamp, checkInstance } from './utils';

import { interpolateRGBAinCieLAB } from '../colorspaces';
import NamedColor from './color/NamedColor';
import Buckets from './buckets';
import Property from './basic/property';
import Classifier from './classification/Classifier';
import ImageList from './ImageList';
import Linear from './linear';
import Top from './top';

const paletteTypes = {
    PALETTE: 'palette',
    COLOR_ARRAY: 'color-array',
    NUMBER_ARRAY: 'number-array',
    IMAGE: 'image'
};

const rampTypes = {
    COLOR: 'color',
    NUMBER: 'number'
};

const inputTypes = {
    NUMBER: 'number',
    CATEGORY: 'category'
};

const COLOR_ARRAY_LENGTH = 256;
const MAX_BYTE_VALUE = 255;

/**
* Create a ramp: a mapping between an input (a numeric or categorical expression) and an output (a color palette or a numeric palette, to create bubble maps)
*
* Categories to colors
* Categorical expressions can be used as the input for `ramp` in combination with color palettes. If the number of categories exceeds the number of available colors in the palette new colors will be generated by
* using CieLAB interpolation.
*
* Categories to numeric
* Categorical expression can be used as the input for `ramp` in combination with numeric palettes. If the number of input categories doesn't match the number of numbers in the numeric palette, linear interpolation will be used.
*
* Numeric expressions to colors
* Numeric expressions can be used as the input for `ramp` in combination with color palettes. Colors will be generated by using CieLAB interpolation.
*
* Numeric expressions to numeric
* Numeric expressions can be used as the input for `ramp` in combination with numeric palettes. Linear interpolation will be used to generate intermediate output values.
*
* @param {Number|Category} input - The input expression to give a color
* @param {Palette|Color[]|Number[]} palette - The color palette that is going to be used
* @return {Number|Color}
*
* @example <caption>Mapping categories to colors and numbers</caption>
* const s = carto.expressions;
* const viz = new carto.Viz({
*   width: s.ramp(s.buckets(s.prop('dn'), [20, 50, 120]), [1, 4, 8])
*   color: s.ramp(s.buckets(s.prop('dn'), [20, 50, 120]), s.palettes.PRISM)
* });
*
* @example <caption>Mapping categories to colors and numbers (String)</caption>
* const viz = new carto.Viz(`
*   width: ramp(buckets($dn, [20, 50, 120]), [1, 10,4])
*   color: ramp(buckets($dn, [20, 50, 120]), prism)
* `);
*
*
* @example <caption>Mapping numeric expressions to colors and numbers</caption>
* const s = carto.expressions;
* const viz = new carto.Viz({
*   width: s.ramp(s.linear(s.prop('dn'), 40, 100), [1, 8])
*   color: s.ramp(s.linear(s.prop('dn'), 40, 100), s.palettes.PRISM)
* });
*
* @example <caption>Mapping numeric expressions to colors and numbers (String)</caption>
* const viz = new carto.Viz(`
*   width: ramp(linear($dn, 40, 100), [1, 10,4])
*   color: ramp(linear($dn, 40, 100), prism)
* `);
*
* @memberof carto.expressions
* @name ramp
* @function
* @api
*/
export default class Ramp extends BaseExpression {
    constructor (input, palette) {
        input = implicitCast(input);
        palette = implicitCast(palette);

        checkExpression('ramp', 'input', 0, input);
        checkLooseType('ramp', 'input', 0, Object.values(inputTypes), input);
        checkLooseType('ramp', 'palette', 1, Object.values(paletteTypes), palette);

        if (palette.type === paletteTypes.IMAGE) {
            checkInstance('ramp', 'palette', 1, ImageList, palette);
            checkLooseType('ramp', 'input', 0, inputTypes.CATEGORY, input);
        }

        palette = _calcPaletteValues(palette);

        super({ input, palette });

        this.minKey = 0;
        this.maxKey = 1;
        this.palette = palette;
        this.type = palette.type === paletteTypes.NUMBER_ARRAY ? rampTypes.NUMBER : rampTypes.COLOR;
        this.defaultOthersColor = new NamedColor('gray');
    }

    loadImages () {
        return Promise.all([this.input.loadImages(), this.palette.loadImages()]);
    }

    _setUID (idGenerator) {
        super._setUID(idGenerator);
        this.palette._setUID(idGenerator);
    }

    eval (feature) {
        this.palette = this._calcPaletteValues(this.palette);

        const texturePixels = this._computeTextureIfNeeded();
        const input = this.input.eval(feature);
        const numValues = texturePixels.length - 1;
        const m = (input - this.minKey) / (this.maxKey - this.minKey);

        const color = this.type === rampTypes.NUMBER
            ? this._getValue(texturePixels, numValues, m)
            : this._getColorValue(texturePixels, m);

        return color;
    }

    _getValue (texturePixels, numValues, m) {
        const lowIndex = clamp(Math.floor(numValues * m), 0, numValues);
        const highIndex = clamp(Math.ceil(numValues * m), 0, numValues);
        const fract = numValues * m - Math.floor(numValues * m);
        const low = texturePixels[lowIndex];
        const high = texturePixels[highIndex];

        return Math.round(fract * high + (1 - fract) * low);
    }

    _getColorValue (texturePixels, m) {
        const index = !Number.isFinite(m) || Number.isNaN(m) ? 0 : Math.round(m * MAX_BYTE_VALUE);

        return {
            r: Math.round(texturePixels[index * 4 + 0]),
            g: Math.round(texturePixels[index * 4 + 1]),
            b: Math.round(texturePixels[index * 4 + 2]),
            a: Math.round(texturePixels[index * 4 + 3]) / MAX_BYTE_VALUE
        };
    }

    _bindMetadata (metadata) {
        super._bindMetadata(metadata);

        if (this.input.isA(Property) && this.input.type === inputTypes.NUMBER) {
            this.input = new Linear(this.input);
            this.input._bindMetadata(metadata);
        }

        checkType('ramp', 'input', 0, Object.values(inputTypes), this.input);

        if (this.palette.type === paletteTypes.IMAGE) {
            checkType('ramp', 'input', 0, inputTypes.CATEGORY, this.input);
            checkInstance('ramp', 'palette', 1, ImageList, this.palette);
        }

        this._texCategories = null;
        this._GLtexCategories = null;
    }

    _applyToShaderSource (getGLSLforProperty) {
        const input = this.input._applyToShaderSource(getGLSLforProperty);

        if (this.palette.type === paletteTypes.IMAGE) {
            const images = this.palette._applyToShaderSource(getGLSLforProperty);

            return {
                preface: input.preface + images.preface,
                inline: `${images.inline}(imageUV, ${input.inline})`
            };
        }

        return {
            preface: this._prefaceCode(input.preface + `
                uniform sampler2D texRamp${this._uid};
                uniform float keyMin${this._uid};
                uniform float keyWidth${this._uid};`
            ),

            inline: this.palette.type === paletteTypes.NUMBER_ARRAY
                ? `(texture2D(texRamp${this._uid}, vec2((${input.inline}-keyMin${this._uid})/keyWidth${this._uid}, 0.5)).a)`
                : `texture2D(texRamp${this._uid}, vec2((${input.inline}-keyMin${this._uid})/keyWidth${this._uid}, 0.5)).rgba`
        };
    }

    _getColorsFromPalette (input, palette) {
        if (palette.type === paletteTypes.IMAGE) {
            return palette.colors;
        }

        return palette.type === paletteTypes.PALETTE
            ? _getColorsFromPaletteType(input, palette, this.maxKey, this.defaultOthersColor.eval())
            : _getColorsFromColorArrayType(input, palette, this.maxKey, this.defaultOthersColor.eval());
    }

    _postShaderCompile (program, gl) {
        if (this.palette.type === paletteTypes.IMAGE) {
            this.palette._postShaderCompile(program, gl);
            super._postShaderCompile(program, gl);
            return;
        }

        this.input._postShaderCompile(program, gl);
        this._getBinding(program).texLoc = gl.getUniformLocation(program, `texRamp${this._uid}`);
        this._getBinding(program).keyMinLoc = gl.getUniformLocation(program, `keyMin${this._uid}`);
        this._getBinding(program).keyWidthLoc = gl.getUniformLocation(program, `keyWidth${this._uid}`);
    }

    _computeTextureIfNeeded () {
        if (this._cachedTexturePixels && !this.palette.isAnimated()) {
            return this._cachedTexturePixels;
        }

        this._texCategories = this.input.numCategories;

        if (this.input.type === inputTypes.CATEGORY) {
            this.maxKey = this.input.numCategories - 1;
        }

        this._cachedTexturePixels = this.type === rampTypes.COLOR
            ? this._computeColorRampTexture()
            : this._computeNumericRampTexture();

        return this._cachedTexturePixels;
    }

    _calcPaletteValues (palette) {
        return _calcPaletteValues(palette);
    }

    _computeColorRampTexture () {
        if (this.palette.isAnimated()) {
            this.palette = this._calcPaletteValues(this.palette);
        }

        const texturePixels = new Uint8Array(4 * COLOR_ARRAY_LENGTH);
        const colors = this._getColorsFromPalette(this.input, this.palette);

        for (let i = 0; i < COLOR_ARRAY_LENGTH; i++) {
            const vColorARaw = colors[Math.floor(i / (COLOR_ARRAY_LENGTH - 1) * (colors.length - 1))];
            const vColorBRaw = colors[Math.ceil(i / (COLOR_ARRAY_LENGTH - 1) * (colors.length - 1))];
            const vColorA = [vColorARaw.r / (COLOR_ARRAY_LENGTH - 1), vColorARaw.g / (COLOR_ARRAY_LENGTH - 1), vColorARaw.b / (COLOR_ARRAY_LENGTH - 1), vColorARaw.a];
            const vColorB = [vColorBRaw.r / (COLOR_ARRAY_LENGTH - 1), vColorBRaw.g / (COLOR_ARRAY_LENGTH - 1), vColorBRaw.b / (COLOR_ARRAY_LENGTH - 1), vColorBRaw.a];
            const m = i / (COLOR_ARRAY_LENGTH - 1) * (colors.length - 1) - Math.floor(i / (COLOR_ARRAY_LENGTH - 1) * (colors.length - 1));
            const v = interpolateRGBAinCieLAB({ r: vColorA[0], g: vColorA[1], b: vColorA[2], a: vColorA[3] }, { r: vColorB[0], g: vColorB[1], b: vColorB[2], a: vColorB[3] }, m);

            texturePixels[4 * i + 0] = Math.round(v.r * MAX_BYTE_VALUE);
            texturePixels[4 * i + 1] = Math.round(v.g * MAX_BYTE_VALUE);
            texturePixels[4 * i + 2] = Math.round(v.b * MAX_BYTE_VALUE);
            texturePixels[4 * i + 3] = Math.round(v.a * MAX_BYTE_VALUE);
        }

        return texturePixels;
    }

    _computeNumericRampTexture () {
        const texturePixels = new Float32Array(COLOR_ARRAY_LENGTH);
        const floats = this.palette.floats;

        for (let i = 0; i < COLOR_ARRAY_LENGTH; i++) {
            const vColorARaw = floats[Math.floor(i / (COLOR_ARRAY_LENGTH - 1) * (floats.length - 1))];
            const vColorBRaw = floats[Math.ceil(i / (COLOR_ARRAY_LENGTH - 1) * (floats.length - 1))];
            const m = i / (COLOR_ARRAY_LENGTH - 1) * (floats.length - 1) - Math.floor(i / (COLOR_ARRAY_LENGTH - 1) * (floats.length - 1));
            texturePixels[i] = ((1.0 - m) * vColorARaw + m * vColorBRaw);
        }

        return texturePixels;
    }

    _computeGLTextureIfNeeded (gl) {
        const texturePixels = this._computeTextureIfNeeded();
        const isAnimatedPalette = this.palette.isAnimated();

        if (this._GLtexCategories !== this.input.numCategories || isAnimatedPalette) {
            this._GLtexCategories = this.input.numCategories;
            this.texture = gl.createTexture();
            this._bindGLTexture(gl, texturePixels);
        }
    }

    _bindGLTexture (gl, texturePixels) {
        gl.bindTexture(gl.TEXTURE_2D, this.texture);

        if (this.type === rampTypes.COLOR) {
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, COLOR_ARRAY_LENGTH, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, texturePixels);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        } else {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, COLOR_ARRAY_LENGTH, 1, 0, gl.ALPHA, gl.FLOAT, texturePixels);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        }

        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    _preDraw (program, drawMetadata, gl) {
        this.input._preDraw(program, drawMetadata, gl);

        if (this.palette.type === paletteTypes.IMAGE) {
            this.palette._preDraw(program, drawMetadata, gl);
            return;
        }

        gl.activeTexture(gl.TEXTURE0 + drawMetadata.freeTexUnit);
        this._computeGLTextureIfNeeded(gl);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(this._getBinding(program).texLoc, drawMetadata.freeTexUnit);
        gl.uniform1f(this._getBinding(program).keyMinLoc, (this.minKey));
        gl.uniform1f(this._getBinding(program).keyWidthLoc, (this.maxKey) - (this.minKey));
        drawMetadata.freeTexUnit++;
    }
}

function _getColorsFromPaletteType (input, palette, numCategories, defaultOthersColor) {
    switch (true) {
        case input.isA(Buckets):
            return _getColorsFromPaletteTypeBuckets(palette, numCategories, defaultOthersColor);
        case input.isA(Top):
            return _getColorsFromPaletteTypeTop(palette, numCategories, defaultOthersColor);
        default:
            return _getColorsFromPaletteTypeDefault(input, palette, defaultOthersColor);
    }
}

function _getColorsFromPaletteTypeBuckets (palette, numCategories, defaultOthersColor) {
    let colors = _getSubPalettes(palette, numCategories);

    if (palette.isQuantitative()) {
        colors.push(defaultOthersColor);
    }

    if (palette.isQualitative()) {
        defaultOthersColor = colors[numCategories];
    }

    return _avoidShowingInterpolation(numCategories, colors, defaultOthersColor);
}

function _getColorsFromPaletteTypeTop (palette, numCategories, defaultOthersColor) {
    let colors = _getSubPalettes(palette, numCategories);

    if (palette.isQualitative()) {
        defaultOthersColor = colors[colors.length - 1];
    }

    return _avoidShowingInterpolation(numCategories, colors, defaultOthersColor);
}

function _getColorsFromPaletteTypeDefault (input, palette, defaultOthersColor) {
    let colors = _getSubPalettes(palette, input.numCategories);

    if (palette.isQualitative()) {
        colors.pop();
        defaultOthersColor = colors[input.numCategories];
    }

    if (input.numCategories === undefined) {
        return colors;
    }

    return _avoidShowingInterpolation(input.numCategories, colors, defaultOthersColor);
}

function _getSubPalettes (palette, numCategories) {
    return palette.subPalettes[numCategories]
        ? palette.subPalettes[numCategories]
        : palette.getLongestSubPalette();
}

function _getColorsFromColorArrayType (input, palette, numCategories, defaultOthersColor) {
    return input.type === inputTypes.CATEGORY
        ? _getColorsFromColorArrayTypeCategorical(input, numCategories, palette.colors, defaultOthersColor)
        : _getColorsFromColorArrayTypeNumeric(input.numCategories, palette.colors);
}

function _getColorsFromColorArrayTypeCategorical (input, numCategories, colors, defaultOthersColor) {
    switch (true) {
        case input.isA(Classifier) && numCategories < colors.length:
            return colors;
        case input.isA(Property):
            return colors;
        case numCategories < colors.length:
            return _avoidShowingInterpolation(numCategories, colors, colors[numCategories]);
        case numCategories > colors.length:
            return _addothersColorToColors(colors, defaultOthersColor);
        default:
            colors = _addothersColorToColors(colors, defaultOthersColor);
            return _avoidShowingInterpolation(numCategories, colors, defaultOthersColor);
    }
}

function _getColorsFromColorArrayTypeNumeric (numCategories, colors) {
    let othersColor;

    if (numCategories < colors.length) {
        othersColor = colors[numCategories];
        return _avoidShowingInterpolation(numCategories, colors, othersColor);
    }

    if (numCategories === colors.length) {
        othersColor = colors[colors.length - 1];
        return _avoidShowingInterpolation(numCategories, colors, othersColor);
    }

    return colors;
}

function _addothersColorToColors (colors, othersColor) {
    return [...colors, othersColor];
}

function _avoidShowingInterpolation (numCategories, colors, defaultOthersColor) {
    const colorArray = [];

    for (let i = 0; i < colors.length; i++) {
        if (i < numCategories) {
            colorArray.push(colors[i]);
        } else if (i === numCategories) {
            colorArray.push(defaultOthersColor);
        }
    }

    return colorArray;
}

function _calcPaletteValues (palette) {
    try {
        if (palette.type === paletteTypes.NUMBER_ARRAY) {
            palette.floats = palette.eval();
        } else if (palette.type === paletteTypes.COLOR_ARRAY) {
            palette.colors = palette.eval();
        }
    } catch (error) {
        throw new Error('Palettes must be formed by constant expressions, they cannot depend on feature properties');
    }

    return palette;
}
