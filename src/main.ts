import * as utils from './utils';
import * as gutils from './geometry';
import * as L from 'leaflet';

// constants
const dataset_metro = 'dataset/rio_metro.csv';
const dataset_bike = 'https://riodejaneiro.publicbikesystem.net/customer/ube/gbfs/v1/en/station_information';
const dataset_constraints = 'dataset/rio_constraints.json';
const map_position = [-22.9668, -43.2029]; // Rio de Janeiro South Zone

// globals
let map: L.Map;                    // leaflet map
let layer_stations: L.LayerGroup;  // layer containing stations
let stations: any = [];            // list of latLng coordinates OF stations
let constraints: any = {};         // an outer polygon and a list of inner polygons
let clicked: any = [];             // list of clicked points
let dragStart: any;                // used to update station position when dragging
let voronoiPolygons: any = [];     // polygons generated by d3-voronoi
let boolMarkers = true;            // show markers on the map
let boolConstraints = false;       // show boundaries on the map
let dataset = 'bike';              // current dataset



/*************************
 *
 * DATA STRUCTURES
 *
 *************************/

interface Station {
  name: string;  // station name
  icon: string;  // icon color
  lat: number;   // latitude
  lng: number;   // longitude
}
function createStation(name: string, lat: number, lng: number, icon: string): Station {
  return {name, lat, lng, icon};
}



/*************************
 *
 * INIT AND UPDATE
 *
 *************************/

function init() {
  // leaflet init
  map = L.map('map').setView(map_position, 14);
  layer_stations = L.layerGroup().addTo(map);

  // callback for map click: create station marker and redraw voronoi
  map.on('click', (e) => {
    if (boolMarkers) {
      stations.push(createStation('new station', e.latlng.lat, e.latlng.lng, 'red'));
      update();
    }
    // hack to get the clicked points in json format, useful to create datasets
    // clicked.push(e.latlng);
    // const jsonContent = JSON.stringify(clicked, null, 2);
    // console.log(jsonContent);
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  // move zoom control to bottom left
  map.zoomControl.setPosition('bottomleft');

  // create buttons
  addButton('Load bike stations', () => {
    dataset = 'bike';
    loadStations();
  });
  addButton('Load metro stations', () => {
    dataset = 'metro';
    loadStations();
  });
  addButton('Toggle markers', () => {
    boolMarkers = !boolMarkers;
    update();
  });
  addButton('Toggle constraints', () => {
    boolConstraints = !boolConstraints;
    // loadStations();
    update();
  });

  // globals
  constraints = {outer: [], inner: []};
}

// recalculate and redraw data on the map
function update() {
  if (stations == null || stations.length == 0) {
    return;
  }

  // recalculate
  let bounds;
  if (boolConstraints) {
    applyConstraintsToPoints();
    [voronoiPolygons, bounds] = gutils.voronoi(stations, constraints.outer);
    applyConstraintsToVoronoi();
  } else {
    [voronoiPolygons, bounds] = gutils.voronoi(stations, stations);
  }

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

  // draw internal constraints
  if (boolConstraints) {
    if (constraints.outer) {
      addPolygon(constraints.outer, 'red', false);
    }
    constraints.inner.forEach(polygon => addPolygon(polygon, 'red', true));
  }

  // draw the "infinite" bounding polygon of the voronoi diagram
  const boundsPolygon = gutils.polygonFromBounds(bounds);
  addPolygon(boundsPolygon, 'green', false);

  // draw points
  if (boolMarkers) {
    stations.forEach(point => {
      addMarker(point);
    });
  }
}



/*************************
 *
 * LOAD DATA
 *
 *************************/

// load stations data from csv or json
function loadStations() {
  let callback = (data) => {
    stations = data.map((station) => {
      return createStation(
        station.name,
        parseFloat(station.lat),
        parseFloat(station.lng != null ? station.lng : station.lon),
        'blue'
      );
    });
    update();
  }
  if (dataset === 'metro') {
    utils.loadCSV(dataset_metro, callback);
  } else if (dataset === 'bike') {
    utils.loadRemoteJSON(dataset_bike, callback);
  }
}

function loadConstraints() {
  utils.loadJSON(dataset_constraints, (data) => {
    constraints = {
      outer: gutils.latLngToArray(data.outer),
      inner: data.inner.map(gutils.latLngToArray)
    }
    // close polygons
    gutils.polygonClose(constraints.outer);
    constraints.inner.forEach(gutils.polygonClose);
    update();
  });
}



/*************************
 *
 * MAP RENDERING
 *
 *************************/

function addButton(label, callback) {
  const button = L.DomUtil.create('button', 'leaflet-left  leaflet-control');
  button.innerHTML = label;
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    callback();
  });
  map.getContainer().appendChild(button);
}

// add a polygon to the map
function addPolygon(points, color, fill) {
  const latLngs = points.map(p => L.latLng(p[0], p[1]));
  L.polygon(latLngs, {color: color, fill: fill, fillOpacity: 0.3}).addTo(map);
}

// add a station point to the map
function addMarker(point) {
  const icon = new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${point.icon}.png`,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
  });
  const marker = L.marker([point.lat, point.lng], {draggable: true, icon: icon});
  marker.addTo(layer_stations);

  // started to drag: save marker position
  marker.on('dragstart', (e) => {
    dragStart = e.target.getLatLng();
  });

  // stoped to drag: update marker position and redraw voronoi
  marker.on('dragend', (e) => {
    const index = stations.findIndex(p => gutils.pointsEqual(p, dragStart));
    stations[index].lat = e.target.getLatLng().lat;
    stations[index].lng = e.target.getLatLng().lng;
    stations[index].icon = (stations[index].icon !== 'red') ? 'orange' : 'red';
    update();
  });

  // show station name on hover
  marker.bindPopup(point.name);
  marker.on('mouseover', function () {
    this.openPopup();
  });
  marker.on('mouseout', function () {
    this.closePopup();
  });

  // click on marker to remove station
  marker.on('click', (e) => {
    const index = stations.findIndex(p => gutils.pointsEqual(p, e.target.getLatLng()));
    stations.splice(index, 1);
    update();
  });
}



/*************************
 *
 * CONSTRAINTS AND OBSTACLES
 *
 *************************/

// remove points that are outside the outer constraint or inside an inner constraint
function applyConstraintsToPoints() {
  if (constraints.outer.length == 0) return; // skip if the outer constraint was not initialized
  stations = stations.filter(point => gutils.pointInPolygon(point, constraints.outer));
  constraints.inner.forEach(polygon => {
    stations = stations.filter(point => !gutils.pointInPolygon(point, polygon));
  });
}

// apply constraints to the voronoi polygons
function applyConstraintsToVoronoi() {
  // clip voronoi polygons to outer polygon
  for (let i = 0; i < voronoiPolygons.length; i++) {
    const new_polygon = gutils.polygonIntersection(voronoiPolygons[i], constraints.outer);
    if (new_polygon) {
      if (new_polygon.length < 3) {
        // TODO: this case only happens when the outer polygon is non convex
        // console.log('clipped polygon has less than 3 points', new_polygon);
      } else {
        voronoiPolygons[i] = new_polygon;
      }
    }
  }

  // remove intersections of obstacles in voronoi polygons
  for (let i = 0; i < voronoiPolygons.length; i++) {
    for (let j = 0; j < constraints.inner.length; j++) {
      const new_polygon = gutils.polygonMinus(voronoiPolygons[i], constraints.inner[j]);
      voronoiPolygons[i] = new_polygon ? new_polygon : voronoiPolygons[i];
    }
  }
}



/*************************
 *
 * MAIN
 *
 *************************/

init();
loadConstraints();
loadStations();

