import type { ReactNode } from 'react';
import { StyleSheet, View as RNView, type StyleProp, type ViewStyle } from 'react-native';

import { View } from '@/components/Themed';
import { border, cardRadius, cardShadow } from '@/constants/theme';

// 안드로이드는 같은 View에 borderRadius+그림자(elevation)를 같이 주면 모서리 클리핑 때문에
// 그림자가 아예 안 그려지는 버그가 있어서, 그림자 전용 바깥 껍데기(흰 배경 필요)와
// 모서리/테두리 담당 안쪽 View를 분리해야 한다. 이 패턴을 매번 반복하지 않도록 공용화.
export function ShadowCard({
  children,
  style,
  contentStyle,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <RNView style={[styles.wrap, style]}>
      <View style={[styles.content, contentStyle]}>{children}</View>
    </RNView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: cardRadius,
    backgroundColor: '#fff',
    ...cardShadow,
  },
  content: {
    borderRadius: cardRadius,
    borderWidth: 1,
    borderColor: border,
  },
});
