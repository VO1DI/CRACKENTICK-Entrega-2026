# Simulador de Cisco IOS para pruebas

GNS3 estÃ¡ instalado en esta mÃ¡quina, pero **no hay imÃ¡genes de Cisco IOS/IOU/CSR**
en `%USERPROFILE%\GNS3\images` (solo CHR y QEMU). Las imÃ¡genes de Cisco son
propietarias y requieren una cuenta/licencia de Cisco; no se descargan solas.

Para probar el flujo SSH de CRACKENTICK sin una imagen real se incluye este
simulador mÃ­nimo de consola IOS. Emula los comandos que usa el proyecto:

- `enable`, `configure terminal`, `terminal length 0`, `end`.
- `vlan`, `name`, `interface`, `switchport`, `ip address`, `no shutdown`.
- `ip route`, `no ip route`.
- `show version`, `show running-config`, `write memory`.

## Uso

```powershell
node pruebas\cisco-sim\server.js
```

Escucha en `127.0.0.1:2322` con usuario `admin` y clave `cisco`.
Para la prueba automÃ¡tica:

```powershell
node pruebas\probar-cisco.js
```

La prueba crea un router Cisco temporal, ejecuta versiÃ³n, respaldo, VLAN,
balanceo y comprueba que un nombre con salto de lÃ­nea no inyecta comandos.

## Con un IOS real

1. Agrega la imagen IOS/IOU a GNS3 y arranca el router.
2. Configura SSH en el IOS.
3. En CRACKENTICK crea un router con fabricante Cisco, host, puerto SSH,
   usuario y clave; el flujo es el mismo que prueba el simulador.

