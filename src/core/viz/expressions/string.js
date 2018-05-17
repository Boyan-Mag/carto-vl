import BaseExpression from './base';
import { checkString } from './utils';

/**
 * Wrapper around string names.
 *
 * @param {string} name
 * @returns {String} string expression with the name provided
 *
 * @memberof carto.expressions
 * @name string
 * @function
 * @api
 */
export default class BaseString extends BaseExpression {
    constructor(name) {
        checkString('string', 'name', 0, name);
        super({});
        this.expr = name;
        this.type = 'string';
    }
    eval() {
        if (this._metadata) {
            // If has metadata return the category ID
            return this._metadata.categoryIDs[this.expr];
        } else {
            // Else return the plain string
            return this.expr;
        }
    }
    isAnimated() {
        return false;
    }
    _compile(metadata) {
        this._metadata = metadata;
    }
    _applyToShaderSource() {
        return {
            preface: this._prefaceCode(`uniform float str${this._uid};\n`),
            inline: `str${this._uid}`
        };
    }
    _postShaderCompile(program, gl) {
        this._getBinding(program).uniformLocation = gl.getUniformLocation(program, `str${this._uid}`);
    }
    _preDraw(program, drawMetadata, gl) {
        const id = this._metadata.categoryIDs[this.expr];
        gl.uniform1f(this._getBinding(program).uniformLocation, id);
    }
}
