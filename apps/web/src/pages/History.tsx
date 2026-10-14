import type { HistoryEntryDTO } from '@celeste/shared';
import { Group, Pagination, Stack, Text, Title } from '@mantine/core';
import { useEffect, useState } from 'react';
import { Art } from '../components/Art';
import { api } from '../lib/api';
import { formatDuration, timeAgo } from '../lib/time';

export function HistoryPage() {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<HistoryEntryDTO[] | null>(null);
  const [pages, setPages] = useState(1);

  useEffect(() => {
    let stale = false;
    api
      .history(page)
      .then((r) => {
        if (stale) return;
        setItems(r.items);
        setPages(Math.max(1, Math.ceil(r.total / r.pageSize)));
      })
      .catch(() => !stale && setItems([]));
    return () => {
      stale = true;
    };
  }, [page]);

  return (
    <Stack gap="md">
      <Title order={3}>History</Title>
      {items === null ? (
        <Text c="dimmed" ta="center" mt="xl">
          Loading…
        </Text>
      ) : items.length === 0 ? (
        <Text c="dimmed" ta="center" py="xl">
          Nothing played yet.
        </Text>
      ) : (
        <Stack gap={6}>
          {items.map((h) => (
            <Group key={h.id} wrap="nowrap" gap="sm" p="xs" className="queue-row">
              <Art src={h.track.artworkUrl} size={44} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <Text size="sm" fw={600} className="ellipsis">
                  {h.track.title}
                </Text>
                <Text size="xs" c="dimmed" className="ellipsis">
                  {h.track.author} · {h.requesterName ?? h.requesterId} · {timeAgo(h.startedAt)}
                </Text>
              </div>
              <Text size="xs" c="dimmed">
                {h.track.isStream ? 'LIVE' : formatDuration(h.track.durationMs)}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
      {pages > 1 && <Pagination total={pages} value={page} onChange={setPage} mx="auto" />}
    </Stack>
  );
}
