import { parseCSV, fetchJSON } from './utils';

import * as turf from '@turf/turf';
import * as L from 'leaflet';
import * as d3 from 'd3-voronoi';
import { VoronoiLayout } from 'd3-voronoi';

// constants
const dataset = 'bike';
const dataset_metro = 'dataset/rio_metro.csv';
const dataset_bike = 'https://riodejaneiro.publicbikesystem.net/customer/ube/gbfs/v1/en/station_information';
const map_position = [-22.9668, -43.2029]; // Rio de Janeiro South Zone

// globals
let map: L.Map;                    // leaflet map
let layer_stations: L.LayerGroup;  // layer containing stations
let stations: any = [];            // list of stations containing lat and lng coordinates
let constraints: any = {};         // an outer polygon and a list of inner polygons
let clicked: any = [];             // list of clicked points
let dragStart: any;                // used to update station position when dragging
let voronoiPolygons: any = [];     // polygons generated by d3-voronoi
let voronoiLayout: VoronoiLayout<[number, number]>; // d3-voronoi layout



/****** LOAD DATA ******/

// load data from a local csv and call the callback with the data
function loadCSV(path, callback) {
  parseCSV(path).then(callback).catch(e => console.log('Error:', e));
}

function loadJSON(path, callback) {
  fetchJSON(path).then(callback).catch(e => console.log('Error:', e));
}

// load data from a remote json and call the callback with the data
async function loadRemoteJSON(url, callback) {
  try {
    const json = await fetchJSON(url);
    callback(json['data']['stations']);
  } catch (error) {
    console.log('Error:', error);
  }
}

// load stations data from csv or json
function loadStations(dataset) {
  let callback = (data) => {
    console.log('Loaded data:', data);
    data.forEach((station) => {
      stations.push({
        name: station['name'],
        lat: station['lat'],
        lng: station['lon'] != null ? station['lon'] : station['lng']
      });
    });
    redraw();
  }
  if (dataset === 'metro') {
    loadCSV(dataset_metro, callback);
  } else if (dataset === 'bike') {
    loadRemoteJSON(dataset_bike, callback);
  }
}

function loadConstraints() {
  let callback = (data) => {
    const map_func = (point) => [point['lat'], point['lng']];
    data['outer'] = data['outer'].map(map_func);
    data['inner'] = data['inner'].map((polygon) => polygon.map(map_func));
    constraints = data
    redraw();
  }
  loadJSON('dataset/rio_constraints.json', callback);
}



/****** MAP INIT AND DRAWING ******/

function init() {
  // leaflet
  map = L.map('map').setView(map_position, 15);
  map.on('click', onMapClick);
  layer_stations = L.layerGroup().addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  // d3
  voronoiLayout = d3.voronoi();

  // globals
  constraints = {'outer': [], 'inner': []};
}

// callback for map click: create station marker and redraw voronoi
function onMapClick(e) {
  stations.push(e.latlng);

  // hack to get the clicked points in json format
  // clicked.push(e.latlng);
  // console.log(clicked)
  // const jsonContent = JSON.stringify(clicked, null, 2);
  // console.log(jsonContent);

  redraw();
}

// add a polygon to the map
function addPolygon(polygon, color, fill) {
  const latLngs = polygon.map(point => L.latLng(point[0], point[1]));
  L.polygon(latLngs, {color: color, fill: fill, fillOpacity: 0.3}).addTo(map);
}

// add a station point to the map
function addMarker(point) {
  const marker = L.marker([point.lat, point.lng], { draggable: true });
  marker.addTo(layer_stations);

  // started to drag: save marker position
  marker.on('dragstart', (e) => {
    dragStart = e.target.getLatLng();
  });

  // stoped to drag: update marker position and redraw voronoi
  marker.on('dragend', (e) => {
    const index = stations.findIndex(p => (p.lat == dragStart.lat) && (p.lng == dragStart.lng));
    stations[index] = e.target.getLatLng();
    redraw();
  });
}

// recalculate and redraw data on the map
function redraw() {
  // recalculate
  voronoi();
  applyConstraints();

  // map cleanup
  layer_stations.clearLayers();
  map.eachLayer((layer) => {
    if (layer instanceof L.Polygon) {
      map.removeLayer(layer);
    }
  });

  // draw voronoi polygons
  voronoiPolygons.forEach(polygon => {
    addPolygon(polygon, 'blue', false);
  });

  // draw constraint polygons
  if (constraints['outer']) {
    addPolygon(constraints['outer'], 'red', false);
  }
  constraints.inner.forEach(polygon => { addPolygon(polygon, 'red', true); });

  // draw points
  stations.forEach(point => {
    // addMarker(point);
  });
}



/****** GEOMETRIC CALCULATIONS ******/

// convert points pairs and calculate voronoi polygons
function voronoi() {
  const positions = stations.map(point => [point.lat, point.lng]);
  const voronoiDiagram = voronoiLayout(positions);
  voronoiPolygons = voronoiDiagram.polygons().map(polygon => polygon.filter(point => point !== null));
}

// apply constraints to the voronoi polygons
function applyConstraints() {
  // remove voronoi polygons outside the outer constraint
  for (let i = 0; i < voronoiPolygons.length; i++) {
    const new_polygon = polygonIntersection(voronoiPolygons[i], constraints.outer);
    voronoiPolygons[i] = new_polygon ? new_polygon : voronoiPolygons[i];
  }

  // remove intersections of inner constraints in voronoi polygons
  for (let i = 0; i < voronoiPolygons.length; i++) {
    for (let j = 0; j < constraints.inner.length; j++) {
      const new_polygon = removeIntersection(voronoiPolygons[i], constraints.inner[j]);
      voronoiPolygons[i] = new_polygon ? new_polygon : voronoiPolygons[i];
    }
  }

  // remove null polygons
  voronoiPolygons = voronoiPolygons.filter(polygon => polygon && polygon.length > 0);
}

// add the first point to the end of the polygon if necessary
function closePolygons(polygons) {
  polygons.forEach(polygon => {
    if (polygon[0] !== polygon[polygon.length - 1]) {
      polygon.push(polygon[0]);
    }
  });
}

// create turf polygons from arrays
function createTurfPolygons(polygon1, polygon2) {
  let tpolygon1 = turf.polygon([polygon1]);
  let tpolygon2 = turf.polygon([polygon2]);

  // validate polygon orientation
  turf.booleanClockwise(tpolygon1.geometry.coordinates[0]) || tpolygon1.geometry.coordinates[0].reverse();
  turf.booleanClockwise(tpolygon2.geometry.coordinates[0]) || tpolygon2.geometry.coordinates[0].reverse();

  return [tpolygon1, tpolygon2];
}

// removes the intersection of the polygon2 in polygon1. Returns a new polygon
function removeIntersection(polygon1, polygon2) {
  closePolygons([polygon1, polygon2]);
  if (polygon1.length < 3 || polygon2.length < 3) {
    return;
  }

  let [tpolygon1, tpolygon2] = createTurfPolygons(polygon1, polygon2);

  // removes the intersection of the polygon2 in polygon1
  const intersection = turf.intersect(tpolygon1, tpolygon2);
  return (intersection != null) ? turf.difference(tpolygon1, intersection).geometry.coordinates[0] : polygon1;
}

// returns a new polygon with the intersection of the polygon1 in polygon2
function polygonIntersection(polygon1, polygon2) {
  closePolygons([polygon1, polygon2]);
  if (polygon1.length < 3 || polygon2.length < 3) {
    return;
  }

  let [tpolygon1, tpolygon2] = createTurfPolygons(polygon1, polygon2);

  // returns the intersection of the polygon1 in polygon2
  const intersection = turf.intersect(tpolygon1, tpolygon2);
  return (intersection != null) ? intersection.geometry.coordinates[0] : [];
}



/****** MAIN ******/

init();
loadConstraints();
loadStations(dataset);











// // TEST INTERSECTION REMOVAL
//
// const p1 = [
//   [-22.968920427317457, -43.213866342319086],
//   [-22.977988327243583, -43.21390925766355],
//   [-22.97862048930051, -43.19991885536773],
//   [-22.968347489350563, -43.20030509346337],
//   [-22.96599644306464, -43.21238576293046]
// ]
// const p2 = [
//   [-22.974667728699558, -43.20958867234942],
//   [-22.9906088339087, -43.20852612667282],
//   [-22.984123929439857, -43.23158730320931]
// ]
// addPolygon(p1, 'red', false);
// addPolygon(p2, 'blue', false);

// const p3 = removeIntersection(p1, p2);
// addPolygon(p3, 'green', false);