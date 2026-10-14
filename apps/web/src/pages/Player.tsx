import {
  FILTER_DEFINITIONS,
  FILTER_PRESETS,
  VOLUME_MAX,
  VOLUME_MIN,
  type FilterPreset,
  type LoopMode,
} from '@celeste/shared';
import {
  ActionIcon,
  Badge,
  Box,
  Card,
  Chip,
  Group,
  Image,
  Slider,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  IconArrowsShuffle,
  IconMusic,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconPlayerSkipForwardFilled,
  IconPlayerStopFilled,
  IconRepeat,
  IconRepeatOff,
  IconRepeatOnce,
  IconVolume,
  IconVolume3,
} from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { act, api } from '../lib/api';
import { usePanel, usePosition } from '../lib/store';
import { formatDuration } from '../lib/time';

const NEXT_LOOP: Record<LoopMode, LoopMode> = { off: 'queue', queue: 'track', track: 'off' };
const LOOP_LABEL: Record<LoopMode, string> = {
  off: 'Loop off',
  queue: 'Loop queue',
  track: 'Loop track',
};

export function PlayerPage() {
  const { player, queue } = usePanel();
  const position = usePosition(player);
  const [scrub, setScrub] = useState<number | null>(null);
  const [vol, setVol] = useState<number | null>(null);

  useEffect(() => setVol(null), [player?.volume]);

  if (!player)
    return (
      <Text c="dimmed" ta="center" mt="xl">
        Loading…
      </Text>
    );

  const cur = player.current;
  const track = cur?.track;
  const radio = player.radio;
  const seekable = !!track && !track.isStream && track.durationMs > 0 && !radio;
  const art = radio?.artUrl ?? track?.artworkUrl ?? null;
  const title = radio?.title ?? track?.title ?? 'Nothing playing';
  const artist = radio ? radio.artist : (track?.author ?? '');
  const shown = scrub ?? position;
  const volume = vol ?? player.volume;
  const ctl = (action: Parameters<typeof api.control>[0]) => () =>
    void act(() => api.control(action));
  const idle = !cur && !radio;

  return (
    <Stack gap="lg" maw={520} mx="auto">
      <div className="hero" style={{ padding: 20 }}>
        {art && <div className="hero-bg" style={{ backgroundImage: `url(${art})` }} />}
        <Stack className="hero-inner" gap="md">
          {art ? (
            <Image src={art} alt="" className="artwork" />
          ) : (
            <div className="artwork">
              <IconMusic size={80} opacity={0.4} />
            </div>
          )}
          <Stack gap={4}>
            <Group gap="xs">
              {radio && (
                <Badge color="pink" variant="filled">
                  Radio · {radio.stationName}
                </Badge>
              )}
              {track && !radio && (
                <Badge variant="light" color="violet" tt="capitalize">
                  {track.source}
                </Badge>
              )}
              {track?.isStream && !radio && (
                <Badge color="red" variant="filled">
                  LIVE
                </Badge>
              )}
              {radio?.listeners != null && (
                <Badge variant="light" color="gray">
                  {radio.listeners} listening
                </Badge>
              )}
            </Group>
            <Title order={2} lineClamp={2}>
              {title}
            </Title>
            <Text c="dimmed" lineClamp={1}>
              {artist || (idle ? 'Search or pick a station to start' : '')}
            </Text>
            {cur && !radio && (
              <Text size="xs" c="dimmed">
                Requested by {cur.requesterName ?? cur.requesterId}
              </Text>
            )}
          </Stack>

          <Box>
            <Slider
              value={seekable ? shown : 0}
              min={0}
              max={seekable ? track.durationMs : 1}
              disabled={!seekable}
              label={(v) => formatDuration(v)}
              onChange={setScrub}
              onChangeEnd={(v) => {
                setScrub(null);
                void act(() => api.seek(v));
              }}
              size="md"
              thumbSize={seekable ? 16 : 0}
              aria-label="Seek"
            />
            <Group justify="space-between" mt={4}>
              <Text size="xs" c="dimmed">
                {track ? formatDuration(shown) : '–:––'}
              </Text>
              <Text size="xs" c="dimmed">
                {seekable ? formatDuration(track.durationMs) : track || radio ? 'LIVE' : '–:––'}
              </Text>
            </Group>
          </Box>

          <Group justify="center" gap="lg" wrap="nowrap">
            <ActionIcon
              size={44}
              variant={player.loop === 'off' ? 'subtle' : 'light'}
              color={player.loop === 'off' ? 'gray' : 'violet'}
              aria-label={LOOP_LABEL[player.loop]}
              title={LOOP_LABEL[player.loop]}
              onClick={ctl({ action: 'loop', value: NEXT_LOOP[player.loop] })}
            >
              {player.loop === 'off' ? (
                <IconRepeatOff />
              ) : player.loop === 'track' ? (
                <IconRepeatOnce />
              ) : (
                <IconRepeat />
              )}
            </ActionIcon>
            <ActionIcon
              size={72}
              radius="xl"
              variant="filled"
              color="violet"
              disabled={idle}
              aria-label={player.paused ? 'Resume' : 'Pause'}
              onClick={ctl({ action: player.paused ? 'resume' : 'pause' })}
            >
              {player.paused ? (
                <IconPlayerPlayFilled size={34} />
              ) : (
                <IconPlayerPauseFilled size={34} />
              )}
            </ActionIcon>
            <ActionIcon
              size={48}
              radius="xl"
              variant="light"
              color="violet"
              disabled={idle}
              aria-label="Skip"
              onClick={ctl({ action: 'skip' })}
            >
              <IconPlayerSkipForwardFilled />
            </ActionIcon>
            <ActionIcon
              size={48}
              radius="xl"
              variant="light"
              color="red"
              disabled={!player.connected}
              aria-label="Stop"
              onClick={ctl({ action: 'stop' })}
            >
              <IconPlayerStopFilled />
            </ActionIcon>
            <ActionIcon
              size={44}
              variant="subtle"
              color="gray"
              aria-label="Shuffle"
              title="Shuffle queue"
              disabled={(queue?.total ?? 0) < 2}
              onClick={ctl({ action: 'shuffle' })}
            >
              <IconArrowsShuffle />
            </ActionIcon>
          </Group>
        </Stack>
      </div>

      <Card withBorder padding="md" radius="lg">
        <Group gap="sm" wrap="nowrap">
          {volume === 0 ? <IconVolume3 size={20} /> : <IconVolume size={20} />}
          <Slider
            flex={1}
            min={VOLUME_MIN}
            max={VOLUME_MAX}
            value={volume}
            marks={[{ value: 100, label: '100' }]}
            onChange={setVol}
            onChangeEnd={(v) => void act(() => api.volume(v))}
            aria-label="Volume"
          />
          <Text size="sm" w={36} ta="right">
            {volume}
          </Text>
        </Group>
      </Card>

      <Card withBorder padding="md" radius="lg">
        <Text fw={600} mb="xs">
          Filter
        </Text>
        <Chip.Group
          multiple={false}
          value={player.filter}
          onChange={(v) => void act(() => api.filter(v as FilterPreset))}
        >
          <Group gap={6}>
            {FILTER_PRESETS.map((p) => (
              <Chip key={p} value={p} size="sm" variant="light">
                {FILTER_DEFINITIONS[p].label}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
      </Card>
    </Stack>
  );
}
