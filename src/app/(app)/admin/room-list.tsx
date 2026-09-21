import { RoomListItem } from './room-list-item';

import type {
  AdminRoomSummary,
  EquipmentSummary,
} from '@/server/modules/room/room.repository';

interface Props {
  rooms: AdminRoomSummary[];
  equipmentOptions: EquipmentSummary[];
  onUpdated: (room: AdminRoomSummary) => void;
  onDeleted: (roomId: string) => void;
}

export function RoomList({
  rooms,
  equipmentOptions,
  onUpdated,
  onDeleted,
}: Props) {
  if (rooms.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">No rooms yet.</p>
    );
  }

  return (
    <ul className="space-y-3">
      {rooms.map((room) => (
        <RoomListItem
          key={room.id}
          room={room}
          equipmentOptions={equipmentOptions}
          onUpdated={onUpdated}
          onDeleted={onDeleted}
        />
      ))}
    </ul>
  );
}
