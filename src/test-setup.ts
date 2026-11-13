// Cada prueba es una carga de página nueva: el guardián de la sesión (uno por negocio y documento) empieza vacío.
import { beforeEach } from 'vitest'
import { documentoNuevoParaPruebas } from './lib/sesionDeCliente'

beforeEach(() => documentoNuevoParaPruebas())
