const {

  app,

  BrowserWindow,

  ipcMain,

} = require('electron')



const path = require('path')

const fs = require('fs')



// ==========================================================

// JANELAS

// ==========================================================



let janelaOperador = null

let janelaTelao = null



// ==========================================================

// ESTADO COMPARTILHADO DA COMPETIÇÃO

// ==========================================================



let estadoCompeticao = null



// ==========================================================

// MONITORAMENTO

// ==========================================================



let watcherResultados = null

let timerAtualizacao = null



// ==========================================================

// CONTROLE DE ESCRITA INTERNA

// ==========================================================



let gravandoResultados = false



// ==========================================================

// ARQUIVOS

// ==========================================================



function caminhoDadosEmpacotados(nomeArquivo) {
  return path.join(
    __dirname,
    '..',
    'dados',
    nomeArquivo,
  )
}

function caminhoPastaDados() {
  if (!app.isPackaged) {
    return path.join(
      __dirname,
      '..',
      'dados',
    )
  }

  return path.join(
    app.getPath('userData'),
    'dados',
  )
}

function caminhoDados(nomeArquivo) {
  return path.join(
    caminhoPastaDados(),
    nomeArquivo,
  )
}

function prepararPastaDados() {
  const pastaDados = caminhoPastaDados()

  if (!fs.existsSync(pastaDados)) {
    fs.mkdirSync(
      pastaDados,
      { recursive: true },
    )
  }

  if (!app.isPackaged) {
    return
  }

  const arquivosIniciais = [
    'competidores.csv',
    'resultados.csv',
  ]

  for (const nomeArquivo of arquivosIniciais) {
    const destino = caminhoDados(nomeArquivo)

    if (fs.existsSync(destino)) {
      continue
    }

    const origem = caminhoDadosEmpacotados(nomeArquivo)

    try {
      if (fs.existsSync(origem)) {
        fs.copyFileSync(origem, destino)
        continue
      }

      if (nomeArquivo === 'resultados.csv') {
        fs.writeFileSync(
          destino,
          'CompetidorID;Tentativa;Execucao;Inicio;Fim;Status;Motivo',
          'utf8',
        )
      }
    } catch (erro) {
      console.error(
        `Erro ao preparar ${nomeArquivo}:`,
        erro,
      )
    }
  }
}

function lerArquivo(nomeArquivo) {

  try {

    return fs.readFileSync(

      caminhoDados(nomeArquivo),

      'utf8',

    )

  } catch (erro) {

    console.error(

      `Erro ao ler ${nomeArquivo}:`,

      erro,

    )



    return ''

  }

}



// ==========================================================

// ENVIO PARA TODAS AS JANELAS

// ==========================================================



function enviarParaTodasAsJanelas(

  canal,

  dados,

) {

  const janelas = [

    janelaOperador,

    janelaTelao,

  ]



  for (const janela of janelas) {

    if (

      janela &&

      !janela.isDestroyed()

    ) {

      janela.webContents.send(

        canal,

        dados,

      )

    }

  }

}



// ==========================================================

// ENVIO DOS RESULTADOS ATUALIZADOS

// ==========================================================



function transmitirResultados() {

  const dados =

    lerArquivo(

      'resultados.csv',

    )



  enviarParaTodasAsJanelas(

    'resultados-atualizados',

    dados,

  )

}



// ==========================================================

// PEQUENA PAUSA SÍNCRONA PARA RETENTATIVA

// ==========================================================



function aguardar(ms) {

  const buffer =

    new SharedArrayBuffer(4)



  const array =

    new Int32Array(buffer)



  Atomics.wait(

    array,

    0,

    0,

    ms,

  )

}



// ==========================================================

// ESCRITA DIRETA COM RETENTATIVAS

// ==========================================================



function gravarArquivoComRetentativas(

  caminho,

  conteudo,

) {

  const maxTentativas = 5



  let ultimoErro = null



  for (

    let tentativa = 1;

    tentativa <= maxTentativas;

    tentativa += 1

  ) {

    try {

      fs.writeFileSync(

        caminho,

        conteudo,

        {

          encoding: 'utf8',

          flag: 'w',

        },

      )



      return

    } catch (erro) {

      ultimoErro = erro



      const codigo =

        erro &&

        typeof erro === 'object'

          ? erro.code

          : null



      const erroTemporario =

        codigo === 'EBUSY' ||

        codigo === 'EPERM' ||

        codigo === 'EACCES'



      if (

        !erroTemporario ||

        tentativa === maxTentativas

      ) {

        throw erro

      }



      /*

       * Alguns programas/serviços do Windows podem segurar

       * o arquivo por poucos milissegundos.

       */



      aguardar(

        tentativa * 50,

      )

    }

  }



  if (ultimoErro) {

    throw ultimoErro

  }

}



// ==========================================================

// ESCRITA SEGURA DO resultados.csv

// ==========================================================



function escreverResultadosCSV(

  conteudo,

) {

  const caminho =

    caminhoDados(

      'resultados.csv',

    )



  const caminhoBackup =

    `${caminho}.bak`



  let conteudoAnterior = null



  gravandoResultados = true



  try {

    // ======================================================

    // 1. LÊ A VERSÃO ATUAL ANTES DE ALTERAR

    // ======================================================



    if (

      fs.existsSync(

        caminho,

      )

    ) {

      conteudoAnterior =

        fs.readFileSync(

          caminho,

          'utf8',

        )

    }



    // ======================================================

    // 2. CRIA BACKUP

    // ======================================================



    if (

      conteudoAnterior !==

      null

    ) {

      fs.writeFileSync(

        caminhoBackup,

        conteudoAnterior,

        'utf8',

      )

    }



    // ======================================================

    // 3. ESCREVE DIRETAMENTE NO ARQUIVO OFICIAL

    //

    // Não usamos unlink.

    // Não usamos rename.

    //

    // Isso evita os erros EPERM/EBUSY que estavam

    // acontecendo no Windows.

    // ======================================================



    gravarArquivoComRetentativas(

      caminho,

      conteudo,

    )



    // ======================================================

    // 4. VERIFICA SE O CONTEÚDO FOI GRAVADO CORRETAMENTE

    // ======================================================



    const conteudoGravado =

      fs.readFileSync(

        caminho,

        'utf8',

      )



    if (

      conteudoGravado !==

      conteudo

    ) {

      throw new Error(

        'Falha de verificação ao salvar resultados.csv.',

      )

    }



    // ======================================================

    // 5. REMOVE BACKUP APÓS SUCESSO

    //

    // Aqui podemos remover o .bak porque ele não é o

    // arquivo que está sendo observado/usado pela aplicação.

    // ======================================================



    if (

      fs.existsSync(

        caminhoBackup,

      )

    ) {

      try {

        fs.unlinkSync(

          caminhoBackup,

        )

      } catch (erroBackup) {

        console.warn(

          'Não foi possível remover resultados.csv.bak:',

          erroBackup,

        )

      }

    }



    // ======================================================

    // 6. ATUALIZA AS DUAS JANELAS IMEDIATAMENTE

    // ======================================================



    transmitirResultados()



    return {

      sucesso: true,

    }

  } catch (erro) {

    console.error(

      'Erro ao salvar resultados.csv:',

      erro,

    )



    // ======================================================

    // RECUPERAÇÃO

    // ======================================================



    try {

      /*

       * Se chegamos a alterar o arquivo e ainda temos

       * o conteúdo anterior em memória, tentamos restaurar.

       */



      if (

        conteudoAnterior !==

        null

      ) {

        gravarArquivoComRetentativas(

          caminho,

          conteudoAnterior,

        )

      }



      transmitirResultados()

    } catch (

      erroRecuperacao

    ) {

      console.error(

        'Erro ao recuperar resultados.csv:',

        erroRecuperacao,

      )

    }



    return {

      sucesso: false,



      erro:

        erro instanceof Error

          ? erro.message

          : String(erro),

    }

  } finally {

    gravandoResultados = false

  }

}



// ==========================================================

// IPC — LEITURA DOS CSVs

// ==========================================================



ipcMain.handle(

  'ler-competidores',

  () => {

    return lerArquivo(

      'competidores.csv',

    )

  },

)



ipcMain.handle(

  'ler-resultados',

  () => {

    return lerArquivo(

      'resultados.csv',

    )

  },

)



// ==========================================================

// IPC — ESCRITA DO resultados.csv

// ==========================================================



ipcMain.handle(

  'salvar-resultados',

  (_event, conteudo) => {

    if (

      typeof conteudo !==

      'string'

    ) {

      return {

        sucesso: false,



        erro:

          'Conteúdo inválido para resultados.csv.',

      }

    }



    return escreverResultadosCSV(

      conteudo,

    )

  },

)



// ==========================================================

// IPC — ESTADO DA COMPETIÇÃO

// ==========================================================



ipcMain.handle(

  'obter-estado-competicao',

  () => {

    return estadoCompeticao

  },

)



ipcMain.handle(

  'atualizar-estado-competicao',

  (_event, novoEstado) => {

    estadoCompeticao =

      novoEstado



    enviarParaTodasAsJanelas(

      'estado-competicao-atualizado',

      estadoCompeticao,

    )
try {
      if (
        estadoCompeticao &&
        estadoCompeticao.estado === 'em_andamento' &&
        estadoCompeticao.fila &&
        estadoCompeticao.fila.length > 0
      ) {
        const vezAtual = estadoCompeticao.fila[estadoCompeticao.indiceAtual]
        if (vezAtual) {
          const dadosFila = `${vezAtual.competidor.id}_${vezAtual.tentativa}`
          const caminhoFila = path.join(caminhoPastaDados(), 'fila_atual.txt')
          fs.writeFileSync(caminhoFila, dadosFila, 'utf8')
        }
      }
    } catch (err) {
      console.error('Erro ao atualizar fila_atual.txt:', err)
    }

    return estadoCompeticao
  },
)


// ==========================================================

// MONITORAMENTO DO resultados.csv

// ==========================================================



function observarResultados() {

  const pastaDados =

    caminhoPastaDados()



  if (

    watcherResultados

  ) {

    watcherResultados.close()

    watcherResultados = null

  }



  try {

    /*

     * Monitoramos a pasta, e não o arquivo individual.

     * Isso também permite edições externas durante os testes.

     */



    watcherResultados =

      fs.watch(

        pastaDados,

        (

          _tipoEvento,

          nomeArquivo,

        ) => {

          if (!nomeArquivo) {

            return

          }



          const nome =

            nomeArquivo.toString()



          if (

            nome !==

            'resultados.csv'

          ) {

            return

          }



          /*

           * Se a alteração veio da própria aplicação,

           * escreverResultadosCSV já fará a transmissão.

           */



          if (

            gravandoResultados

          ) {

            return

          }



          if (

            timerAtualizacao

          ) {

            clearTimeout(

              timerAtualizacao,

            )

          }



timerAtualizacao = setTimeout(() => {
        transmitirResultados()

        // Auto-finaliza o motor se o Python inseriu o resultado válido no CSV
        if (
          estadoCompeticao &&
          estadoCompeticao.estado === 'em_andamento' &&
          (estadoCompeticao.corrida === 'correndo' || estadoCompeticao.corrida === 'aguardando')
        ) {
          try {
            const vezAtual = estadoCompeticao.fila[estadoCompeticao.indiceAtual]
            if (vezAtual) {
              const caminhoCsv = caminhoDados('resultados.csv')
              if (fs.existsSync(caminhoCsv)) {
                const conteudoCsv = fs.readFileSync(caminhoCsv, 'utf8')
                const linhas = conteudoCsv.split('\n')
                let temResultadoInjetado = false

                for (const linha of linhas) {
                  const colunas = linha.split(';')
                  if (colunas.length >= 6) {
                    const cid = parseInt(colunas[0], 10)
                    const tentativa = parseInt(colunas[1], 10)
                    const status = colunas[5].trim().toUpperCase()

                    if (cid === vezAtual.competidor.id && tentativa === vezAtual.tentativa && status === 'VALIDA') {
                      temResultadoInjetado = true
                      break
                    }
                  }
                }

                if (temResultadoInjetado) {
                  estadoCompeticao.corrida = 'finalizada'
                  enviarParaTodasAsJanelas('estado-competicao-atualizado', estadoCompeticao)
                }
              }
            }
          } catch (err) {
            console.error('Erro na auto-finalização:', err)
          }
        }
      }, 150)

        },

      )



    watcherResultados.on(

      'error',

      (erro) => {

        console.error(

          'Erro no monitoramento de resultados.csv:',

          erro,

        )

      },

    )

  } catch (erro) {

    console.error(

      'Não foi possível iniciar o monitoramento de resultados.csv:',

      erro,

    )

  }

}



// ==========================================================

// CONFIGURAÇÃO COMUM DAS JANELAS

// ==========================================================



function configuracaoWeb() {

  return {

    preload: path.join(

      __dirname,

      'preload.cjs',

    ),



    contextIsolation: true,

    nodeIntegration: false,

  }

}



// ==========================================================

// JANELA DO OPERADOR

// ==========================================================



// ==========================================================
// CARREGAMENTO DA INTERFACE — DEV / PRODUÇÃO
// ==========================================================

function carregarInterface(janela, tela) {
  if (app.isPackaged) {
    return janela.loadFile(
      path.join(
        __dirname,
        '..',
        'dist',
        'index.html',
      ),
      {
        query: { tela },
      },
    )
  }

  return janela.loadURL(
    `http://localhost:5173/?tela=${tela}`,
  )
}

function criarJanelaOperador() {

  janelaOperador =

    new BrowserWindow({

      width: 1280,

      height: 800,



      title:

        'DTec — Painel do Operador',



      webPreferences:

        configuracaoWeb(),

    })



  carregarInterface(

    janelaOperador,

    'operador',

  )



  janelaOperador.on(

    'closed',

    () => {

      janelaOperador = null

    },

  )

}



// ==========================================================

// JANELA DO TELÃO

// ==========================================================



function criarJanelaTelao() {

  janelaTelao =

    new BrowserWindow({

      width: 1280,

      height: 720,



      title:

        'DTec — Telão Público',



      webPreferences:

        configuracaoWeb(),

    })



  carregarInterface(

    janelaTelao,

    'telao',

  )



  janelaTelao.on(

    'closed',

    () => {

      janelaTelao = null

    },

  )

}



// ==========================================================

// INICIALIZAÇÃO

// ==========================================================



app.whenReady().then(

  () => {

    prepararPastaDados()

    criarJanelaOperador()

    criarJanelaTelao()



    observarResultados()



    app.on(

      'activate',

      () => {

        if (

          BrowserWindow

            .getAllWindows()

            .length === 0

        ) {

          criarJanelaOperador()

          criarJanelaTelao()

        }

      },

    )

  },

)



// ==========================================================

// ENCERRAMENTO

// ==========================================================



app.on(

  'before-quit',

  () => {

    if (

      watcherResultados

    ) {

      watcherResultados.close()

      watcherResultados = null

    }



    if (

      timerAtualizacao

    ) {

      clearTimeout(

        timerAtualizacao,

      )



      timerAtualizacao = null

    }

  },

)



app.on(

  'window-all-closed',

  () => {

    if (

      process.platform !==

      'darwin'

    ) {

      app.quit()

    }

  },

)
