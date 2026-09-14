import React, { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet-draw/dist/leaflet.draw.css';
import { Polygon, Point, MapData } from '../../types/mapTypes';

interface ZoneEditorProps {
  mapData: MapData;
  setMapData: React.Dispatch<React.SetStateAction<MapData>>;
}

export const ZoneEditor: React.FC<ZoneEditorProps> = ({ mapData, setMapData }) => {
  const map = useMap();

  useEffect(() => {
    const drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    const drawControl = new L.Control.Draw({
      edit: { featureGroup: drawnItems },
      draw: {
        polygon: true,
        polyline: false,
        rectangle: false,
        circle: false,
        marker: false,
        circlemarker: false,
      },
    });

    map.addControl(drawControl);

    const handleCreated = (e: any) => {
      const layer = e.layer;
      const points = layer.getLatLngs()[0].map((latlng: L.LatLng) => ({
        lat: latlng.lat,
        lng: latlng.lng,
      }));

      const newPolygon: Polygon = {
        id: `zone-${Date.now()}`,
        name: `Zone ${mapData.zones.length + 1}`,
        points,
        color: getRandomColor(),
      };

      setMapData(prev => ({
        ...prev,
        zones: [...prev.zones, newPolygon],
      }));

      drawnItems.addLayer(layer);
    };

    map.on(L.Draw.Event.CREATED, handleCreated);

    return () => {
      map.removeControl(drawControl);
      map.removeLayer(drawnItems);
      map.off(L.Draw.Event.CREATED, handleCreated);
    };
  }, [map, mapData.zones.length, setMapData]);

  const getRandomColor = () => {
    const colors = ['#FF5733', '#33FF57', '#3357FF', '#F3FF33', '#FF33F3', '#33F3FF'];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  return null;
};
