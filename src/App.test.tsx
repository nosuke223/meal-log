import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from './App'

test('見出し「meal-log」を描画する', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: 'meal-log' })).toBeInTheDocument()
})
