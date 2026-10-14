import { Image, Box } from '@mantine/core';
import { IconMusic } from '@tabler/icons-react';

export function Art({
  src,
  size,
  radius = 10,
}: {
  src: string | null | undefined;
  size: number;
  radius?: number;
}) {
  if (src)
    return (
      <Image
        src={src}
        w={size}
        h={size}
        radius={radius}
        fit="cover"
        alt=""
        style={{ flex: 'none' }}
      />
    );
  return (
    <Box
      w={size}
      h={size}
      style={{
        flex: 'none',
        borderRadius: radius,
        background: 'var(--mantine-color-dark-5)',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--mantine-color-dimmed)',
      }}
    >
      <IconMusic size={size * 0.45} />
    </Box>
  );
}
