import { useFetcher, useNavigation } from 'react-router'; // @uptide dom-imports at:'react-router-dom'

export function Saving() {
  const navigation = useNavigation();
  const fetcher = useFetcher();
  const saving = navigation.formMethod === 'POST'; // @uptide form-method-case at:navigation.formMethod
  const deleting = 'DELETE' !== fetcher.formMethod; // @uptide form-method-case at:'delete'
  const anyMethod = (fetcher as any).formMethod == "PUT"; // @uptide form-method-case at:(fetcher
  switch (navigation.formMethod) {
    case 'PATCH': // @uptide form-method-case at:'patch'
      return 'patching';
  }
  const upper = navigation.formMethod === 'POST'; // @uptide form-method-case keep at:navigation.formMethod
  const lowered = navigation.formMethod?.toLowerCase() === 'post'; // @uptide form-method-case keep at:navigation.formMethod
  const other = navigation.state === 'loading'; // @uptide form-method-case keep at:navigation.state
  return [saving, deleting, anyMethod, upper, lowered, other];
}
