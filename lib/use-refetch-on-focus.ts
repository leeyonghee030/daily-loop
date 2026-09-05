import { useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';

// react-query 공식 React Native 가이드의 표준 패턴. useQuery는 마운트 시 이미 알아서 한 번
// 불러오므로, 화면에 처음 들어올 때(=마운트와 동시에 포커스) 또 한 번 부르면 중복 요청이 됨
// (오늘 탭에서 실제로 겪었던 버그와 같은 종류). 그래서 "첫 포커스는 건너뛰고, 그다음 포커스부터"
// refetch를 호출한다 — 다른 탭 갔다가 돌아올 때만 다시 불러오게 됨.
//
// enabled: refetch()는 useQuery의 enabled 옵션과 무관하게 무조건 실행되는 함수라서, 로그인
// 직후처럼 userId가 아직 준비되기 전에 포커스가 오면 undefined인 채로 쿼리가 실행돼 서버에
// "invalid input syntax for type uuid: undefined" 같은 에러가 나는 버그가 있었음 — 호출부에서
// enabled(보통 !!userId)를 넘기면 그 조건이 꺼져있는 동안은 refetch를 건너뛴다.
export function useRefetchOnFocus(refetch: () => void, enabled: boolean = true) {
  const enabledRef = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (enabledRef.current) {
        if (enabled) refetch();
      } else {
        enabledRef.current = true;
      }
    }, [refetch, enabled])
  );
}
