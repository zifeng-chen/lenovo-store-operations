export function hasUnexpectedPlacardOverflow(card) {
  const rootRect = card.getBoundingClientRect()
  return [card, ...card.querySelectorAll('*')].some((node) => {
    const widthOverflow = node.scrollWidth > node.clientWidth + 1
    const heightOverflow = node.scrollHeight > node.clientHeight + 1
    if (!widthOverflow && !heightOverflow) return false

    const logo = node.querySelector('.service-title-logo')
    const allowsServiceLogo = !widthOverflow
      && (node.classList.contains('service-header') || node.classList.contains('service-title-slot'))
      && logo
    if (!allowsServiceLogo) return true

    const logoRect = logo.getBoundingClientRect()
    return logoRect.left < rootRect.left - 1
      || logoRect.right > rootRect.right + 1
      || logoRect.top < rootRect.top - 1
      || logoRect.bottom > rootRect.bottom + 1
  })
}
