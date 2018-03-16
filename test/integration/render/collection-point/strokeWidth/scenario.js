const map = new carto.Map({
    container: 'map',
    background: 'black'
});

const source = new carto.source.GeoJSON(sources['collection-point']);
const style = new carto.Style(`
    strokeWidth: 2
`);
const layer = new carto.Layer('layer', source, style);

layer.addTo(map);