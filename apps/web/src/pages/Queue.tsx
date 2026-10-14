import type { QueueItemDTO } from '@celeste/shared';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ActionIcon, Button, Group, Stack, Text, Title } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconGripVertical, IconTrash, IconX } from '@tabler/icons-react';
import { Art } from '../components/Art';
import { act, api } from '../lib/api';
import { usePanel } from '../lib/store';
import { formatDuration, formatTotal } from '../lib/time';

function Row({ item, index }: { item: QueueItemDTO; index: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  return (
    <div
      ref={setNodeRef}
      className={`queue-row${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <Group wrap="nowrap" gap="sm" p="xs">
        <ActionIcon
          variant="transparent"
          color="gray"
          className="drag-handle"
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <IconGripVertical size={18} />
        </ActionIcon>
        <Text size="sm" c="dimmed" w={20} ta="right">
          {index + 1}
        </Text>
        <Art src={item.track.artworkUrl} size={44} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text size="sm" fw={600} className="ellipsis">
            {item.track.title}
          </Text>
          <Text size="xs" c="dimmed" className="ellipsis">
            {item.track.author}
          </Text>
        </div>
        <Text size="xs" c="dimmed">
          {item.track.isStream ? 'LIVE' : formatDuration(item.track.durationMs)}
        </Text>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={`Remove ${item.track.title}`}
          onClick={() => void act(() => api.remove(item.id))}
        >
          <IconX size={18} />
        </ActionIcon>
      </Group>
    </div>
  );
}

export function QueuePage() {
  const { queue, setQueue } = usePanel();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (!queue)
    return (
      <Text c="dimmed" ta="center" mt="xl">
        Loading…
      </Text>
    );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = queue.items.findIndex((i) => i.id === active.id);
    const to = queue.items.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    const prev = queue;
    // Optimistic reorder; the SSE queue event reconciles, and we roll back on failure.
    setQueue({
      ...queue,
      items: arrayMove(queue.items, from, to).map((it, i) => ({ ...it, position: i + 1 })),
    });
    void act(() => api.move(from + 1, to + 1)).then((r) => {
      if (!r) setQueue(prev);
    });
  };

  const confirmClear = () =>
    modals.openConfirmModal({
      title: 'Clear the queue?',
      children: (
        <Text size="sm">
          This removes all {queue.total} upcoming tracks. The current track keeps playing.
        </Text>
      ),
      labels: { confirm: 'Clear queue', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: () => void act(() => api.clear()),
    });

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <div>
          <Title order={3}>Up next</Title>
          <Text size="sm" c="dimmed">
            {queue.total} {queue.total === 1 ? 'track' : 'tracks'}
            {queue.totalDurationMs > 0 && ` · ${formatTotal(queue.totalDurationMs)}`}
          </Text>
        </div>
        <Button
          variant="light"
          color="red"
          leftSection={<IconTrash size={16} />}
          disabled={queue.total === 0}
          onClick={confirmClear}
        >
          Clear
        </Button>
      </Group>
      {queue.items.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          The queue is empty. Add something from Search.
        </Text>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={queue.items.map((i) => i.id)}
            strategy={verticalListSortingStrategy}
          >
            <Stack gap={6}>
              {queue.items.map((item, i) => (
                <Row key={item.id} item={item} index={i} />
              ))}
            </Stack>
          </SortableContext>
        </DndContext>
      )}
    </Stack>
  );
}
