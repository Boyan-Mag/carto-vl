import * as s from '../../../../../../src/renderer/viz/expressions';
import { CartoValidationTypes as cvt } from '../../../../../../src/errors/carto-validation-error';
import { validateMaxArgumentsError } from '../utils';

describe('src/renderer/viz/expressions/basic/array', () => {
    describe('error control', () => {
        validateMaxArgumentsError('array', ['number', 'number']);
    });

    describe('type', () => {
    });

    describe('constructor', () => {
        it('should throw an error when the array is empty ', () => {
            const missingRequired = cvt.MISSING_REQUIRED + ' array(): invalid parameters: must receive at least one argument.';
            expect(() => s.array()
            ).toThrowError(missingRequired);

            expect(() => s.array([])
            ).toThrowError(missingRequired);
        });

        it('should throw an error when the array constains different types ', () => {
            expect(() => s.array([1, 'a'])
            ).toThrowError(cvt.INCORRECT_TYPE + ' array(): invalid second parameter, invalid argument type combination.');
        });
    });

    describe('.value', () => {
        it('should return array of numbers', () => {
            const actual = s.array([1, 2, 3]).value;

            expect(actual).toEqual([1, 2, 3]);
        });

        it('should return array of string', () => {
            const actual = s.array(['a', 'b', 'c']).value;

            expect(actual).toEqual(['a', 'b', 'c']);
        });

        it('should return array of colors', () => {
            const actual = s.array([s.hex('#F00'), s.hex('#00F')]).value;

            expect(actual).toEqual([
                { r: 255, g: 0, b: 0, a: 1 },
                { r: 0, g: 0, b: 255, a: 1 }]);
        });

        it('should return array of dates', () => {
            const actual = s.array([s.date('2022-03-09T00:00:00Z')]).value;

            expect(actual).toEqual([new Date('2022-03-09T00:00:00Z')]);
        });
    });

    describe('.eval', () => {
        it('should return the float value', () => {
            const actual = s.number(101).eval();

            expect(actual).toEqual(101);
        });
    });
});
