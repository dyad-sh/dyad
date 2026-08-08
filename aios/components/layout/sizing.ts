export const HORIZONTAL_COOKIE = 'react-resizable-panels:horizontal'
export const VERTICAL_COOKIE = 'react-resizable-panels:vertical'
export const getHorizontal = getSizes(HORIZONTAL_COOKIE)
export const getVertical = getSizes(VERTICAL_COOKIE)

function getSizes(cookie: string) {
  return (store: {
    get: (key: string) => { value: string } | undefined
  }): number[] | undefined => {
    const value = store.get(cookie)
    return value ? JSON.parse(value.value) : undefined
  }
}
