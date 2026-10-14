import { SEARCH_SOURCES, type SearchResultDTO, type SearchSource } from '@celeste/shared';
import {
  ActionIcon,
  Button,
  Group,
  Loader,
  Stack,
  Tabs,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconLink, IconPlayerTrackNext, IconPlus, IconSearch } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Art } from '../components/Art';
import { act, api, ApiFailure } from '../lib/api';
import { formatDuration } from '../lib/time';

const LABELS: Record<SearchSource, string> = {
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  applemusic: 'Apple Music',
};

export function SearchPage() {
  const [source, setSource] = useState<SearchSource>('youtube');
  const [text, setText] = useState('');
  const [debounced] = useDebouncedValue(text.trim(), 350);
  const [results, setResults] = useState<SearchResultDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (debounced.length < 2) {
      setResults([]);
      return;
    }
    let stale = false;
    setLoading(true);
    api
      .search(debounced, source)
      .then((r) => !stale && setResults(r))
      .catch((e) => {
        if (stale || (e instanceof ApiFailure && e.code === 'session_ended')) return;
        notifications.show({
          color: e instanceof ApiFailure && e.status === 429 ? 'yellow' : 'red',
          title: e instanceof ApiFailure && e.status === 429 ? 'Slow down' : 'Search failed',
          message: e instanceof Error ? e.message : String(e),
        });
      })
      .finally(() => !stale && setLoading(false));
    return () => {
      stale = true;
    };
  }, [debounced, source]);

  const add = async (query: string, next: boolean, title?: string) => {
    const r = await act(() => (next ? api.playNext(query) : api.play(query)));
    if (r)
      notifications.show({
        color: 'green',
        message: `${next ? 'Playing next' : 'Added'}${title ? `: ${title}` : ''}`,
      });
    return r;
  };

  const submitUrl = async () => {
    const q = url.trim();
    if (!q) return;
    if (await add(q, false)) setUrl('');
  };

  return (
    <Stack gap="md">
      <Group wrap="nowrap" align="end">
        <TextInput
          flex={1}
          label="Paste a link"
          placeholder="https://…"
          value={url}
          leftSection={<IconLink size={16} />}
          onChange={(e) => setUrl(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submitUrl()}
        />
        <Button onClick={() => void submitUrl()} disabled={!url.trim()}>
          Add
        </Button>
      </Group>

      <Tabs value={source} onChange={(v) => v && setSource(v as SearchSource)} variant="pills">
        <Tabs.List style={{ flexWrap: 'nowrap', overflowX: 'auto' }}>
          {SEARCH_SOURCES.map((s) => (
            <Tabs.Tab key={s} value={s}>
              {LABELS[s]}
            </Tabs.Tab>
          ))}
        </Tabs.List>
      </Tabs>

      <TextInput
        placeholder={`Search ${LABELS[source]}…`}
        value={text}
        size="md"
        leftSection={<IconSearch size={18} />}
        rightSection={loading ? <Loader size="xs" /> : null}
        onChange={(e) => setText(e.currentTarget.value)}
      />

      <Stack gap={6}>
        {results.map((r) => (
          <Group key={r.uri} wrap="nowrap" gap="sm" p="xs" className="queue-row">
            <Art src={r.artworkUrl} size={48} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <Text size="sm" fw={600} className="ellipsis">
                {r.title}
              </Text>
              <Text size="xs" c="dimmed" className="ellipsis">
                {r.author}
                {!r.isStream && r.durationMs > 0
                  ? ` · ${formatDuration(r.durationMs)}`
                  : r.isStream
                    ? ' · LIVE'
                    : ''}
              </Text>
            </div>
            <Tooltip label="Play next">
              <ActionIcon
                variant="light"
                color="violet"
                size="lg"
                aria-label="Play next"
                onClick={() => void add(r.uri, true, r.title)}
              >
                <IconPlayerTrackNext size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Add to queue">
              <ActionIcon
                variant="filled"
                color="violet"
                size="lg"
                aria-label="Add to queue"
                onClick={() => void add(r.uri, false, r.title)}
              >
                <IconPlus size={18} />
              </ActionIcon>
            </Tooltip>
          </Group>
        ))}
        {!loading && debounced.length >= 2 && results.length === 0 && (
          <Text c="dimmed" ta="center" py="lg">
            No results.
          </Text>
        )}
      </Stack>
    </Stack>
  );
}
