import { Center, Stack, Text, Title, ThemeIcon } from '@mantine/core';
import { IconPlayerStop } from '@tabler/icons-react';

export function EndedPage() {
  return (
    <Center mih="100vh" p="lg">
      <Stack align="center" gap="md" maw={420} ta="center">
        <ThemeIcon size={84} radius="xl" variant="light" color="violet">
          <IconPlayerStop size={44} />
        </ThemeIcon>
        <Title order={2}>This session is over</Title>
        <Text c="dimmed">
          The music stopped and this link no longer works. A new link appears in Discord when music
          starts again.
        </Text>
      </Stack>
    </Center>
  );
}
