import {
  ActionIcon,
  Avatar,
  Badge,
  Container,
  Group,
  Text,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import {
  IconHistory,
  IconListDetails,
  IconMoon,
  IconPlayerPlayFilled,
  IconRadio,
  IconSearch,
  IconSun,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { usePanel } from '../lib/store';

const TABS = [
  { to: '/player', label: 'Playing', icon: IconPlayerPlayFilled },
  { to: '/queue', label: 'Queue', icon: IconListDetails },
  { to: '/search', label: 'Search', icon: IconSearch },
  { to: '/radio', label: 'Radio', icon: IconRadio },
  { to: '/history', label: 'History', icon: IconHistory },
];

export function Shell({ children }: { children: ReactNode }) {
  const { session, live } = usePanel();
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme('dark');

  return (
    <>
      <Container size="md" pt="sm" pb="xs">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap" miw={0}>
            <Avatar src={session?.guild.iconUrl} radius="xl" size={40} color="violet">
              {session?.guild.name.slice(0, 1) ?? 'C'}
            </Avatar>
            <div style={{ minWidth: 0 }}>
              <Text fw={700} lh={1.2} className="ellipsis">
                {session?.guild.name ?? 'Celeste'}
              </Text>
              <Text size="xs" c="dimmed" className="ellipsis">
                {session ? `in ${session.voiceChannel.name}` : 'Connecting…'}
              </Text>
            </div>
          </Group>
          <Group gap="xs" wrap="nowrap">
            <Badge variant="dot" color={live ? 'green' : 'yellow'} size="sm">
              {live ? 'Live' : 'Reconnecting'}
            </Badge>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="Toggle color scheme"
              onClick={() => setColorScheme(scheme === 'dark' ? 'light' : 'dark')}
            >
              {scheme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
            </ActionIcon>
          </Group>
        </Group>
        <Group className="top-nav" mt="sm" gap="xs">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} style={{ textDecoration: 'none' }}>
              {({ isActive }) => (
                <Badge
                  size="lg"
                  radius="xl"
                  variant={isActive ? 'filled' : 'light'}
                  color={isActive ? 'violet' : 'gray'}
                  leftSection={<t.icon size={14} />}
                  style={{ cursor: 'pointer' }}
                >
                  {t.label}
                </Badge>
              )}
            </NavLink>
          ))}
        </Group>
      </Container>
      <Container size="md" className="shell-main" component="main">
        {children}
      </Container>
      <nav className="bottom-nav" aria-label="Primary">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'active' : '')}>
            <t.icon size={22} />
            {t.label}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
