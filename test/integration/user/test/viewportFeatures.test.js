import carto from '../../../../src';
import * as util from '../../util';

const feature1 = {
    type: 'Feature',
    geometry: {
        type: 'Point',
        coordinates: [0, 0]
    },
    properties: {
        id: 1,
        value: 10,
        category: 'a'
    }
};

const feature2 = {
    type: 'Feature',
    geometry: {
        type: 'Point',
        coordinates: [10, 12]
    },
    properties: {
        id: 2,
        value: 1000,
        category: 'b'
    }
};

const features = {
    type: 'FeatureCollection',
    features: [ feature1, feature2 ]
};

function checkFeatures (list, expectedList) {
    // FIXME: this shouldn't require list to have the same order as expected
    expect(list.length).toEqual(expectedList.length);
    for (let i = 0; i < list.length; ++i) {
        const actual = {};
        const expected = expectedList[i];
        Object.keys(expected).forEach(prop => {
            actual[prop] = list[i][prop];
        });
        expect(actual).toEqual(expected);
    }
}

describe('viewportFeatures', () => {
    let map, source1, viz1, layer1, source2, viz2, layer2, setup;

    beforeEach(() => {
        setup = util.createMap('map');
        map = setup.map;

        source1 = new carto.source.GeoJSON(features);
        viz1 = new carto.Viz(`
            @list: viewportFeatures($value,$category)
        `);
        layer1 = new carto.Layer('layer1', source1, viz1);

        source2 = new carto.source.GeoJSON(features);
        viz2 = new carto.Viz(`
            @cat: $category
            @list2all: viewportFeatures($value,@cat,$id)
            @list2value: viewportFeatures($value)
        `);
        layer2 = new carto.Layer('layer2', source2, viz2);

        layer1.addTo(map);
        layer2.addTo(map);
    });

    it('should get the features properties of one layer', done => {
        layer1.on('loaded', () => {
            const expected = [
                { value: 10, category: 'a' },
                { value: 1000, category: 'b' }
            ];
            checkFeatures(viz1.variables.list.eval(), expected);
            done();
        });
    });

    it('should get the features properties of another layer', done => {
        layer2.on('loaded', () => {
            const expectedAll = [
                { id: 1, value: 10, category: 'a' },
                { id: 2, value: 1000, category: 'b' }
            ];
            const expectedValue = [
                { value: 10 },
                { value: 1000 }
            ];
            checkFeatures(viz2.variables.list2all.eval(), expectedAll);
            checkFeatures(viz2.variables.list2value.eval(), expectedValue);
            done();
        });
    });

    afterEach(() => {
        document.body.removeChild(setup.div);
    });
});

describe('viewportFeatures on a map with filters', () => {
    let map, source1, viz1, layer1, source2, viz2, layer2, setup;

    beforeEach(() => {
        setup = util.createMap('map');
        map = setup.map;

        source1 = new carto.source.GeoJSON(features);
        viz1 = new carto.Viz(`
            @list: viewportFeatures($value,$category)
            filter: $value < 100
        `);
        layer1 = new carto.Layer('layer1', source1, viz1);

        source2 = new carto.source.GeoJSON(features);
        viz2 = new carto.Viz(`
            @list2all: viewportFeatures($value,$category,$id)
            @list2value: viewportFeatures($value)
            filter: $value > 10
        `);
        layer2 = new carto.Layer('layer2', source2, viz2);

        layer1.addTo(map);
        layer2.addTo(map);
    });

    it('should get the filtered feature properties of one layer', done => {
        layer1.on('loaded', () => {
            const expected = [
                { value: 10, category: 'a' }
            ];
            checkFeatures(viz1.variables.list.eval(), expected);
            done();
        });
    });

    it('should get the filtered feature properties of another layer', done => {
        layer2.on('loaded', () => {
            const expectedAll = [
                { id: 2, value: 1000, category: 'b' }
            ];
            const expectedValue = [
                { value: 1000 }
            ];
            checkFeatures(viz2.variables.list2all.eval(), expectedAll);
            checkFeatures(viz2.variables.list2value.eval(), expectedValue);
            done();
        });
    });

    afterEach(() => {
        document.body.removeChild(setup.div);
    });
});

describe('viewportFeatures on a zoomed-in map', () => {
    let map, source1, viz1, layer1, source2, viz2, layer2, setup;

    beforeEach(() => {
        setup = util.createMap('map');
        map = setup.map;
        map.setZoom(10);

        source1 = new carto.source.GeoJSON(features);
        viz1 = new carto.Viz(`
            @list: viewportFeatures($value,$category)
        `);
        layer1 = new carto.Layer('layer1', source1, viz1);

        source2 = new carto.source.GeoJSON(features);
        viz2 = new carto.Viz(`
            @list2all: viewportFeatures($value,$category,$id)
            @list2value: viewportFeatures($value)
        `);
        layer2 = new carto.Layer('layer2', source2, viz2);

        layer1.addTo(map);
        layer2.addTo(map);
    });

    it('should get only in-viewport feature properties of one layer', done => {
        layer1.on('loaded', () => {
            const expected = [
                { value: 10, category: 'a' }
            ];
            checkFeatures(viz1.variables.list.eval(), expected);
            done();
        });
    });

    it('should get only in-viewport features properties of another layer', done => {
        layer2.on('loaded', () => {
            const expectedAll = [
                { id: 1, value: 10, category: 'a' }
            ];
            const expectedValue = [
                { value: 10 }
            ];
            checkFeatures(viz2.variables.list2all.eval(), expectedAll);
            checkFeatures(viz2.variables.list2value.eval(), expectedValue);
            done();
        });
    });

    afterEach(() => {
        document.body.removeChild(setup.div);
    });
});

describe('viewportFeatures with invalid parameters', () => {
    let map, source, viz, layer, setup;

    beforeEach(() => {
        setup = util.createMap('map');
        map = setup.map;

        source = new carto.source.GeoJSON(features);
        viz = new carto.Viz(`
            @list: viewportFeatures($value,$category,11)
        `);
        layer = new carto.Layer('layer', source, viz);

        layer.addTo(map);
    });

    it('should fail with proper error', done => {
        expect(
            () => {
                // FIXME: this isn't nice (calling the private method _resetViewportAgg to force the check here)
                // but, how to avoid the exception happening asynchronously?
                viz.variables.list._resetViewportAgg();
            }
        ).toThrowError(/arguments can only be properties/);
        done();
    });

    afterEach(() => {
        map.remove();
        document.body.removeChild(setup.div);
    });
});

describe('viewportFeatures collision', () => {
    const innerTriangle = {
        type: 'Feature',
        geometry: {
            type: 'Polygon',
            coordinates: [
                [ [0, 50], [0, 0], [50, 0], [0, 50] ]
            ]
        },
        properties: {
            cartodb_id: 1,
            value: 1,
            category: 'a'
        }
    };

    const intersectingTriangle = {
        type: 'Feature',
        geometry: {
            type: 'Polygon',
            coordinates: [
                [ [165, 50], [165, 0], [215, 0], [165, 50] ]
            ]
        },
        properties: {
            cartodb_id: 2,
            value: 2,
            category: 'b'
        }
    };

    const outerTriangle = {
        type: 'Feature',
        geometry: {
            type: 'Polygon',
            coordinates: [
                [ [200, 50], [200, 0], [250, 0], [200, 50] ]
            ]
        },
        properties: {
            cartodb_id: 3,
            value: 3,
            category: 'c'
        }
    };

    const outerBBOXTriangle = {
        type: 'Feature',
        geometry: {
            type: 'Polygon',
            coordinates: [
                [ [-226, -70], [-226, -85], [-176, -85], [-226, -70] ]
            ]
        },
        properties: {
            cartodb_id: 4,
            value: 4,
            category: 'd'
        }
    };

    function generateData (features) {
        return { type: 'FeatureCollection', features };
    }

    let map, viz1, layer1, source1, setup;

    beforeEach(() => {
        const VIEWPORT_SIZE = 500;

        setup = util.createMap('map', VIEWPORT_SIZE);
        map = setup.map;

        source1 = new carto.source.GeoJSON(
            generateData([
                innerTriangle,
                intersectingTriangle,
                outerTriangle,
                outerBBOXTriangle
            ]),
            {
                id: 'cartodb_id',
                value: ['value'],
                category: ['category']
            }
        );

        viz1 = new carto.Viz(`
              color: red,
              strokeWidth: 0,
              @list: viewportFeatures($value ,$category, $cartodb_id);
            `);

        layer1 = new carto.Layer('layer1', source1, viz1);
        layer1.addTo(map);
    });

    it('should get the properties in the viewport', done => {
        layer1.on('loaded', () => {
            const expected = [
                { cartodb_id: 1, value: 1, category: 'a' },
                { cartodb_id: 2, value: 2, category: 'b' }
            ];

            checkFeatures(viz1.variables.list.eval(), expected);
            done();
        });
    });

    afterEach((done) => {
        document.body.removeChild(setup.div);
        done();
    });
});
