import regional from '../../providers/moveuskadi-sources.json';
export type Source = { id: string; name: string; color: string; gtfs: string; tripUpdates?: string; vehiclePositions?: string; maximumGpsSpeed?: number };
export const primary: Source[] = [
  { id: 'metro-bilbao', name: 'Metro Bilbao', color: '#d95038', gtfs: 'https://opendata.euskadi.eus/transport/moveuskadi/metro_bilbao/gtfs_metro_bilbao.zip', tripUpdates: 'https://opendata.euskadi.eus/transport/moveuskadi/metro_bilbao/gtfsrt_metro_bilbao_trip_updates.pb' },
  { id: 'euskotren', name: 'Euskotren', color: '#3275a6', gtfs: 'https://opendata.euskadi.eus/transport/moveuskadi/euskotren/gtfs_euskotren.zip', tripUpdates: 'https://opendata.euskadi.eus/transport/moveuskadi/euskotren/gtfsrt_euskotren_trip_updates.pb' },
];
export const regionalSources: Source[] = regional;
export const renfeSource: Source = { id: 'renfe', name: 'Renfe Cercanías', color: '#be1747', gtfs: 'https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip', maximumGpsSpeed: 40, tripUpdates: 'https://gtfsrt.renfe.com/trip_updates.pb', vehiclePositions: 'https://gtfsrt.renfe.com/vehicle_positions.pb' };
