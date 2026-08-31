import { useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';

// react-query 공식 React Native 가이드의 표준 패턴. useQuery는 마운트 시 이미 알아서 한 번
// 불러오므로, 화면에 처음 들어올 때(=마운트와 동시에 포커스) 또 한 번 부르면 중복 요청이 됨
// (오늘 탭에서 실제로 겪었던 버그와 같은 종류). 그래서 "첫 포커스는 건너뛰고, 그다음 포커스부터"
// refetch를 호출한다 — 다른 탭 갔다가 돌아올 때만 다시 불러오게 됨.
export function useRefetchOnFocus(refetch: () => void) {
  const enabledRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (enabledRef.current) {
        refetch();
      } else {
        enabledRef.current = true;
      }
    }, [refetch])
  );
}
