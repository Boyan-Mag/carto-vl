import BaseExpression from './base';
import { implicitCast, checkExpression, checkType, clamp, checkInstance, checkMaxArguments, mix } from './utils';

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
    LABEL: 'label',
    IMAGE_LIST: 'image-list'
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
const SQRT_MAX_CATEGORIES_PER_PROPERTY = 256;

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
        checkMaxArguments(arguments, 2, 'ramp');

        input = implicitCast(input);
        palette = implicitCast(palette);

        checkExpression('ramp', 'input', 0, input);
        checkExpression('ramp', 'palette', 1, palette);

        super({ input, palette });

        this.minKey = 0;
        this.maxKey = 1;
        this.palette = palette;
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
        if (this.palette.type === 'number-array') {
            return this._evalNumberArray(feature);
        }
        const input = this.input.eval(feature);
        this.palette = this._calcPaletteValues(this.palette);
        const texturePixels = this._computeTextureIfNeeded();
        const numValues = texturePixels.length - 1;
        const m = (input - this.minKey) / (this.maxKey - this.minKey);

        const color = this.type === rampTypes.NUMBER
            ? this._getValue(texturePixels, numValues, m)
            : this._getColorValue(texturePixels, m);

        return color;
    }

    _evalNumberArray (feature) {
        const input = this.input.eval(feature);
        const m = (input - this.minKey) / (this.maxKey - this.minKey);
        for (let i = 0; i < this.palette.elems.length - 1; i++) {
            const rangeMin = i / (this.palette.elems.length - 1);
            const rangeMax = (i + 1) / (this.palette.elems.length - 1);
            if (m > rangeMax) {
                continue;
            }
            const rangeM = (m - rangeMin) / (rangeMax - rangeMin);
            const a = this.palette.elems[i].eval(feature);
            const b = this.palette.elems[i + 1].eval(feature);
            return mix(a, b, clamp(rangeM, 0, 1));
        }
        throw new Error('Unexpected condition on ramp._evalNumberArray()');
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
        const index = _calcColorValueIndex(m);

        return {
            r: Math.round(texturePixels[index * 4 + 0]),
            g: Math.round(texturePixels[index * 4 + 1]),
            b: Math.round(texturePixels[index * 4 + 2]),
            a: Math.round(texturePixels[index * 4 + 3]) / MAX_BYTE_VALUE
        };
    }

    _bindMetadata (metadata) {
        super._bindMetadata(metadata);

        this.type = this.palette.type === paletteTypes.NUMBER_ARRAY ? rampTypes.NUMBER : rampTypes.COLOR;
        if (this.palette.type === 'image-list') {
            this.type = 'image';
        }

        if (this.palette.type !== 'number-array') {
            this.palette = _calcPaletteValues(this.palette);
        }

        if (this.input.isA(Property) && this.input.type === inputTypes.NUMBER) {
            this.input = new Linear(this.input);
            this.input._bindMetadata(metadata);
        }

        checkType('ramp', 'input', 0, Object.values(inputTypes), this.input);

        if (this.palette.type === paletteTypes.IMAGE_LIST) {
            checkType('ramp', 'input', 0, inputTypes.CATEGORY, this.input);
            checkInstance('ramp', 'palette', 1, ImageList, this.palette);
        }

        this._texCategories = null;
        this._GLtexCategories = null;
        this._metadata = metadata;
    }

    _applyToShaderSource (getGLSLforProperty) {
        if (this.palette.type === paletteTypes.IMAGE_LIST) {
            return this._applyToShaderSourceImage(getGLSLforProperty);
        }

        const input = this.input._applyToShaderSource(getGLSLforProperty);

        let inline = '';
        let preface = `
        uniform float keyMin${this._uid};
        uniform float keyWidth${this._uid};
        `;

        let inputGLSL;
        if (this.input.type === 'category' && this.input.isA(Property)) {
            // With categorical inputs we need to translate their global(per-dataset) IDs to local (per-property) IDs
            inputGLSL = `ramp_translate${this._uid}(${input.inline})`;
            preface +=
            `
            uniform sampler2D texRampTranslate${this._uid};
            float ramp_translate${this._uid}(float s){
                vec2 v = vec2(
                    mod(s, ${SQRT_MAX_CATEGORIES_PER_PROPERTY.toFixed(20)}),
                    floor(s / ${SQRT_MAX_CATEGORIES_PER_PROPERTY.toFixed(20)})
                );
                return texture2D(texRampTranslate${this._uid}, v/${SQRT_MAX_CATEGORIES_PER_PROPERTY.toFixed(20)}).a;
            }
            `;
        } else {
            // With numerical inputs we only need to transform the input to the [0,1] range
            inputGLSL = `((${input.inline}-keyMin${this._uid})/keyWidth${this._uid})`;
        }

        if (this.palette.type === 'number-array') {
            // With numeric arrays we use a combination of `mix` to allow for property-dependant values
            const nums = this.palette.elems.map(elem => elem._applyToShaderSource(getGLSLforProperty));
            const genBlend = (list, numerator, denominator) => {
                let b;

                if (numerator + 1 === denominator) {
                    b = list[numerator + 1].inline;
                } else {
                    b = genBlend(list, numerator + 1, denominator);
                }

                return `
                mix(${list[numerator].inline}, ${b},
                    clamp(
                         (x-${(numerator / denominator).toFixed(20)})
                             /${(1 / denominator).toFixed(20)}
                        ,0.,1.
                        )
                )`;
            };
            inline = `ramp_num${this._uid}(${inputGLSL})`;
            // the ramp_num function looks up the numeric array this.palette and performs linear interpolation to retrieve the final result
            // For example:
            //   with this.palette.elems=[10,20] ram_num(0.4) will return 14
            //   with this.palette.elems=[0, 10, 30] ramp_num(0.75) will return 20
            //   with this.palette.elems=[0, 10, 30] ramp_num(0.5) will return 10
            //   with this.palette.elems=[0, 10, 30] ramp_num(0.25) will return 5
            preface += `${nums.map(n => n.preface).join('\n')}

            float ramp_num${this._uid}(float x){
                return ${genBlend(nums, 0, this.palette.elems.length - 1)};
            }
            `;
        } else {
            // With color arrays we use a fast texture lookup, but this makes property-dependant values impossible
            inline = `texture2D(texRamp${this._uid}, vec2(${inputGLSL}, 0.5)).rgba`;
            preface += `uniform sampler2D texRamp${this._uid};\n`;
        }

        if (this.palette.type === paletteTypes.LABEL) {
            const labels = this.palette._applyToShaderSource(getGLSLforProperty);

            return {
                preface: input.preface + labels.preface,
                inline: `${labels.inline}(labelUV, ${input.inline})`
            };
        }

        return {
            preface: this._prefaceCode(input.preface + preface),
            inline
        };
    }

    _applyToShaderSourceImage (getGLSLforProperty) {
        const input = this.input._applyToShaderSource(getGLSLforProperty);
        const images = this.palette._applyToShaderSource(getGLSLforProperty);
        return {
            preface: input.preface + images.preface,
            inline: `${images.inline}(imageUV, ${input.inline})`
        };
    }

    _getColorsFromPalette (input, palette) {
        if (palette.type === paletteTypes.IMAGE_LIST) {
            return palette.colors;
        }

        return palette.type === paletteTypes.PALETTE
            ? _getColorsFromPaletteType(input, palette, this.maxKey, this.defaultOthersColor.eval())
            : _getColorsFromColorArrayType(input, palette, this.maxKey, this.defaultOthersColor.eval());
    }

    _postShaderCompile (program, gl) {
        if (this.palette.type === paletteTypes.IMAGE_LIST) {
            this.palette._postShaderCompile(program, gl);
            super._postShaderCompile(program, gl);
            return;
        }
        if (this.palette.type === 'number-array') {
            this.palette.elems.forEach(e => e._postShaderCompile(program, gl));
        }

        this.input._postShaderCompile(program, gl);
        this._getBinding(program).texLoc = gl.getUniformLocation(program, `texRamp${this._uid}`);
        this._getBinding(program).texRampTranslateLoc = gl.getUniformLocation(program, `texRampTranslate${this._uid}`);
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

        if (this.palette.type === paletteTypes.IMAGE_LIST) {
            this.palette._preDraw(program, drawMetadata, gl);
            return;
        } else if (this.palette.type === 'number-array') {
            this.palette.elems.forEach(e => e._preDraw(program, drawMetadata, gl));
            gl.uniform1i(this._getBinding(program).texLoc, drawMetadata.freeTexUnit);
            gl.uniform1f(this._getBinding(program).keyMinLoc, (this.minKey));
            gl.uniform1f(this._getBinding(program).keyWidthLoc, (this.maxKey) - (this.minKey));
            return super._preDraw(program, drawMetadata, gl);
        }

        gl.activeTexture(gl.TEXTURE0 + drawMetadata.freeTexUnit);
        this._computeGLTextureIfNeeded(gl);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.uniform1i(this._getBinding(program).texLoc, drawMetadata.freeTexUnit);
        gl.uniform1f(this._getBinding(program).keyMinLoc, (this.minKey));
        gl.uniform1f(this._getBinding(program).keyWidthLoc, (this.maxKey) - (this.minKey));
        drawMetadata.freeTexUnit++;

        if (this.input.type === 'category' && this.input.isA(Property)) {
            gl.activeTexture(gl.TEXTURE0 + drawMetadata.freeTexUnit);
            const catIDs = this._metadata.properties[this.input.name].categories.length;
            if (this._translatedIds !== catIDs) {
                this._translatedIds = catIDs;
                this._translateTexture = gl.createTexture();
                const translatorPixels = new Float32Array(SQRT_MAX_CATEGORIES_PER_PROPERTY * SQRT_MAX_CATEGORIES_PER_PROPERTY);
                for (let i = 0; i < catIDs; i++) {
                    const id = this._metadata.categoryToID.get(this._metadata.properties[this.input.name].categories[i].name);
                    const value = i / (catIDs - 1);
                    const vec2Id = {
                        x: id % SQRT_MAX_CATEGORIES_PER_PROPERTY,
                        y: Math.floor(id / SQRT_MAX_CATEGORIES_PER_PROPERTY)
                    };
                    translatorPixels[SQRT_MAX_CATEGORIES_PER_PROPERTY * vec2Id.y + vec2Id.x] = value;
                }
                gl.bindTexture(gl.TEXTURE_2D, this._translateTexture);
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, SQRT_MAX_CATEGORIES_PER_PROPERTY, SQRT_MAX_CATEGORIES_PER_PROPERTY, 0, gl.ALPHA, gl.FLOAT, translatorPixels);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            } else {
                gl.bindTexture(gl.TEXTURE_2D, this._translateTexture);
            }
            gl.uniform1i(this._getBinding(program).texRampTranslateLoc, drawMetadata.freeTexUnit);
            drawMetadata.freeTexUnit++;
        }
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
            return _addOthersColorToColors(colors, defaultOthersColor);
        default:
            colors = _addOthersColorToColors(colors, defaultOthersColor);
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

function _addOthersColorToColors (colors, othersColor) {
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

function _calcColorValueIndex (m) {
    if (Number.isNaN(m) || m === Number.NEGATIVE_INFINITY) {
        return 0;
    }

    if (m === Number.POSITIVE_INFINITY || m > 1) {
        return COLOR_ARRAY_LENGTH - 1;
    }

    return Math.round(m * MAX_BYTE_VALUE);
}
