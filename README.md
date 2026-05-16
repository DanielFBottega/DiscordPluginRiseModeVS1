# Discord Pro Control for StreamDock

Este é um plugin avançado para StreamDock (Rise Mode / HotSpot) que utiliza o protocolo RPC do Discord para fornecer controle total sobre áudio, voz e informações de usuários diretamente no seu deck.

## 🚀 Funcionalidades

- **Mute/Unmute**: Controle de microfone com feedback visual em tempo real.
- **Deafen/Undeafen**: Controle de áudio do sistema.
- **Lista de Usuários**: Veja quem está no seu canal de voz atual.
- **Indicador de Voz**: Veja visualmente quem está falando no momento.
- **Controle de Volume Individual**: (Em desenvolvimento) Ajuste o volume de outros usuários.
- **Resiliência Total**: Reconexão automática ao Discord e StreamDock.

## 🛠️ Instalação

1. Certifique-se de ter o [Node.js](https://nodejs.org/) instalado.
2. Clone este repositório na pasta de plugins do seu StreamDock:
   `%APPDATA%\HotSpot\StreamDock\plugins\com.daniel.discordpro.sdPlugin`
3. Instale as dependências:
   ```bash
   npm install
   ```
4. Deve criar um app no discord developer portal
   1. entre em https://discord.com/developers/applications
   2. clique em "New Application"
   3. dê um nome ao app
   4. clique em "Create"
   5. vá em OAuth2
   6. copie ID do cliente para env
   7. clique em "Reset Secret" para copiar o segredo para env
   8. clique em "Add Redirect" e adicione http://localhost

## ⚙️ Configuração

Crie um arquivo `.env` na raiz do projeto com suas credenciais do Discord Developer Portal:

```env
CLIENT_ID=seu_client_id
CLIENT_SECRET=seu_client_secret
```

## 📄 Licença

Este projeto está sob a licença MIT. Criado por Daniel.
