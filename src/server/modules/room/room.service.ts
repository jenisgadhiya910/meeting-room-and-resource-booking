import {
  listRooms as listRoomsRepo,
  searchAvailableRooms as searchAvailableRoomsRepo,
} from './room.repository';

import type { RoomPage } from './room.repository';
import type { AvailabilityQuery, ListRoomsQuery } from './room.schema';

export async function listRooms(query: ListRoomsQuery): Promise<RoomPage> {
  return listRoomsRepo({
    minCapacity: query.minCapacity,
    equipmentKeys: query.equipment,
    limit: query.limit,
    cursor: query.cursor,
  });
}

export async function searchAvailableRooms(
  query: AvailabilityQuery,
): Promise<RoomPage> {
  return searchAvailableRoomsRepo({
    minCapacity: query.minCapacity,
    equipmentKeys: query.equipment,
    limit: query.limit,
    cursor: query.cursor,
    from: new Date(query.from),
    to: new Date(query.to),
  });
}
