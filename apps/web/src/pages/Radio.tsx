import type { RadioStationDTO } from '@celeste/shared';
import { Badge, Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useState } from 'react';
import { Art } from '../components/Art';
import { act, api } from '../lib/api';
import { usePanel } from '../lib/store';

export function RadioPage() {
  const { player, radio } = usePanel();
  const [stations, setStations] = useState<RadioStationDTO[] | null>(null);

  useEffect(() => {
    let stop = false;
    const load = () =>
      api
        .stations()
        .then((s) => !stop && setStations(s))
        .catch(() => {});
    void load();
    const id = setInterval(load, 20000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  if (!stations)
    return (
      <Text c="dimmed" ta="center" mt="xl">
        Loading…
      </Text>
    );
  if (stations.length === 0)
    return (
      <Text c="dimmed" ta="center" mt="xl">
        No radio stations are configured.
      </Text>
    );

  const activeId = player?.radio?.stationId;
  return (
    <Stack gap="md">
      <Title order={3}>Radio</Title>
      <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }} spacing="sm">
        {stations.map((s) => {
          const active = s.id === activeId;
          const np = active && radio ? radio : s.nowPlaying;
          return (
            <Card
              key={s.id}
              withBorder
              padding="sm"
              radius="lg"
              className="station-card"
              style={active ? { borderColor: 'var(--mantine-color-violet-5)' } : undefined}
              role="button"
              tabIndex={0}
              onClick={async () => {
                const r = await act(() => api.playRadio(s.id));
                if (r) notifications.show({ color: 'green', message: `Tuning to ${s.name}` });
              }}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.click()}
            >
              <Group wrap="nowrap" gap="sm">
                <Art src={np?.artUrl} size={64} radius={12} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Group gap={6} wrap="nowrap">
                    {active && (
                      <span className="eq" aria-label="Playing">
                        <i />
                        <i />
                        <i />
                      </span>
                    )}
                    <Text fw={700} className="ellipsis">
                      {s.name}
                    </Text>
                  </Group>
                  <Badge size="xs" variant="light" color="gray" mb={2}>
                    {s.sourceLabel}
                  </Badge>
                  <Text size="xs" className="ellipsis">
                    {np?.title ?? 'No info'}
                  </Text>
                  <Text size="xs" c="dimmed" className="ellipsis">
                    {np?.artist}
                  </Text>
                </div>
              </Group>
            </Card>
          );
        })}
      </SimpleGrid>
    </Stack>
  );
}
