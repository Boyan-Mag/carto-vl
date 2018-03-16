import * as earcut from 'earcut';


// Decode a tile geometry
// If the geometry type is 'point' it will pass trough the geom (the vertex array)
// If the geometry type is 'polygon' it will triangulate the polygon list (geom)
//      geom will be a list of polygons in which each polygon will have a flat array of vertices and a list of holes indices
//      Example:
/*         let geom = [
                {
                    flat: [
                        0.,0., 1.,0., 1.,1., 0.,1., 0.,0, //A square
                        0.25,0.25, 0.75,0.25, 0.75,0.75, 0.25,0.75, 0.25,0.25//A small square
                    ]
                    holes: [5]
                }
            ]
*/
// If the geometry type is 'line' it will generate the appropriate zero-sized, vertex-shader expanded triangle list with mitter joints.
// The geom will be an array of coordinates in this case
export function decodeGeom(geomType, geom) {
    if (geomType == 'point') {
        return decodePoint(geom);
    }
    if (geomType == 'polygon') {
        return decodePolygon(geom);
    }
    if (geomType == 'line') {
        return decodeLine(geom);
    }
    throw new Error(`Unimplemented geometry type: '${geomType}'`);
}

function decodePoint(geometry) {
    return {
        geometry: geometry,
        breakpointList: []
    };
}


function decodePolygon(geometry) {
    let vertexArray = []; //Array of triangle vertices
    let breakpointList = []; // Array of indices (to vertexArray) that separate each feature
    geometry.map(feature => {
        feature.map(polygon => {
            const triangles = earcut(polygon.flat, polygon.holes);
            triangles.map(index => {
                vertexArray.push(polygon.flat[2 * index]);
                vertexArray.push(polygon.flat[2 * index + 1]);
            });
        });
        breakpointList.push(vertexArray.length);
    });
    return {
        geometry: new Float32Array(vertexArray),
        breakpointList
    };
}

function decodeLine(geom) {
    let normals = [];
    let geometry = [];
    let breakpointList = []; // Array of indices (to vertexArray) that separate each feature
    geom.map(feature => {
        feature.map(lineString => {
            // Create triangulation
            
            for (let i = 0; i < lineString.length - 2; i += 2) {
                const a = [lineString[i + 0], lineString[i + 1]];
                const b = [lineString[i + 2], lineString[i + 3]];
                const normal = getLineNormal(b, a);
                let na = normal;
                let nb = normal;
                
                if (i > 0) {
                    const prev = [lineString[i + -2], lineString[i + -1]];
                    na = getCornerVector(prev, a, b) || na;
                }
                if (i < lineString.length - 4) {
                    const next = [lineString[i + 4], lineString[i + 5]];
                    nb = getCornerVector(a, b, next) || nb;
                }

                // First triangle
    
                normals.push(-na[0], -na[1]);
                normals.push(na[0], na[1]);
                normals.push(-nb[0], -nb[1]);
    
                geometry.push(a[0], a[1]);
                geometry.push(a[0], a[1]);
                geometry.push(b[0], b[1]);

                // Second triangle
    
                normals.push(na[0], na[1]);
                normals.push(nb[0], nb[1]);
                normals.push(-nb[0], -nb[1]);
    
                geometry.push(a[0], a[1]);
                geometry.push(b[0], b[1]);
                geometry.push(b[0], b[1]);
            }
        });
        breakpointList.push(geometry.length);
    });
    return {
        geometry: new Float32Array(geometry),
        breakpointList,
        normals: new Float32Array(normals)
    };
}

function getLineNormal(a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    return normalize([-dy, dx]);
}

function getCornerVector(a, b, c) {
    const u = normalize([a[0] - b[0], a[1] - b[1]]);
    const v = normalize([c[0] - b[0], c[1] - b[1]]);
    const sin = - u[1] * v[0] + u[0] * v[1];
    if (sin !== 0) {
        return [(u[0] + v[0]) / sin, (u[1] + v[1]) / sin];
    }
    
}

function normalize(v) {
    const s = Math.sqrt(v[0] * v[0] + v[1] * v[1]);
    return [v[0] / s, v[1] / s];
}

export default { decodeGeom };