'use client'

import React, { useState, useEffect } from 'react'
import Editor from '@monaco-editor/react'
import { Play, Download, FileText, Loader2, CheckCircle, XCircle, Rocket, Wallet, ExternalLink } from 'lucide-react'
import axios from 'axios'
import * as nearAPI from 'near-api-js'

interface CompileResponse {
  success: boolean
  output: string
  errors?: string
  wasm_size?: number
}

interface ContractTemplate {
  name: string
  description: string
  code: string
}

interface WalletConnection {
  accountId: string
  isSignedIn: boolean
}

interface DeployResponse {
  success: boolean
  transactionHash?: string
  contractId?: string
  error?: string
}

const API_BASE_URL = 'http://localhost:8080'

export default function NEARContractEditor() {
  const [code, setCode] = useState('')
  const [contractName, setContractName] = useState('hello_near')
  const [compiling, setCompiling] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [compileResult, setCompileResult] = useState<CompileResponse | null>(null)
  const [deployResult, setDeployResult] = useState<DeployResponse | null>(null)
  const [templates, setTemplates] = useState<ContractTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [wallet, setWallet] = useState<WalletConnection>({ accountId: '', isSignedIn: false })
  const [nearConnection, setNearConnection] = useState<any>(null)

  // Default NEAR contract template
  const defaultCode = `use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::{env, near_bindgen, AccountId};

#[near_bindgen]
#[derive(Default, BorshDeserialize, BorshSerialize)]
pub struct Contract {
    greeting: String,
}

#[near_bindgen]
impl Contract {
    pub fn get_greeting(&self) -> String {
        self.greeting.clone()
    }

    pub fn set_greeting(&mut self, message: String) {
        env::log_str(&format!("Saving greeting: {}", message));
        self.greeting = message;
    }

    pub fn say_hello(&self, account: AccountId) -> String {
        format!("{}, {}!", self.greeting, account)
    }
}`

  useEffect(() => {
    setCode(defaultCode)
    fetchTemplates()
    initializeNear()
  }, [])

  const initializeNear = async () => {
    try {
      const { keyStores, connect, WalletConnection } = nearAPI
      
      const config = {
        networkId: 'testnet',
        keyStore: new keyStores.BrowserLocalStorageKeyStore(),
        nodeUrl: 'https://rpc.testnet.near.org',
        walletUrl: 'https://testnet.mynearwallet.com/',
        helperUrl: 'https://helper.testnet.near.org',
        explorerUrl: 'https://testnet.nearblocks.io',
      }

      const near = await connect(config)
      const walletConnection = new WalletConnection(near, 'near-contract-editor')
      
      setNearConnection({ near, wallet: walletConnection })
      
      if (walletConnection.isSignedIn()) {
        setWallet({
          accountId: walletConnection.getAccountId(),
          isSignedIn: true
        })
      }
    } catch (error) {
      console.error('Failed to initialize NEAR:', error)
    }
  }

  const connectWallet = async () => {
    if (nearConnection?.wallet) {
      nearConnection.wallet.requestSignIn({
        contractId: '',
        methodNames: []
      })
    }
  }

  const disconnectWallet = async () => {
    if (nearConnection?.wallet) {
      nearConnection.wallet.signOut()
      setWallet({ accountId: '', isSignedIn: false })
      setDeployResult(null)
    }
  }

  const fetchTemplates = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/templates`)
      setTemplates(response.data)
    } catch (error) {
      console.error('Failed to fetch templates:', error)
    } finally {
      setLoading(false)
    }
  }

  const compileContract = async () => {
    if (!code.trim() || !contractName.trim()) {
      alert('Please provide both contract name and code')
      return
    }

    setCompiling(true)
    setCompileResult(null)
    setDeployResult(null)

    try {
      const response = await axios.post(`${API_BASE_URL}/compile`, {
        code,
        contract_name: contractName
      })
      setCompileResult(response.data)
    } catch (error) {
      setCompileResult({
        success: false,
        output: '',
        errors: `Network error: ${error}`
      })
    } finally {
      setCompiling(false)
    }
  }

  const deployContract = async () => {
    if (!compileResult?.success) {
      alert('Please compile the contract successfully first')
      return
    }

    if (!wallet.isSignedIn) {
      alert('Please connect your wallet first')
      return
    }

    setDeploying(true)
    setDeployResult(null)

    try {
      // Get the WASM file from backend
      const wasmResponse = await axios.get(`${API_BASE_URL}/download-wasm/${contractName}`, {
        responseType: 'arraybuffer'
      })
      
      const wasmCode = new Uint8Array(wasmResponse.data)
      const account = nearConnection.wallet.account()
      
      // Generate unique contract ID based on current timestamp
      const timestamp = Date.now()
      const contractId = `${contractName}_${timestamp}.${wallet.accountId}`
      
      // Deploy contract
      const result = await account.deployContract(wasmCode)
      
      setDeployResult({
        success: true,
        transactionHash: result.transaction.hash,
        contractId: contractId
      })

    } catch (error: any) {
      console.error('Deployment failed:', error)
      setDeployResult({
        success: false,
        error: error.message || 'Deployment failed'
      })
    } finally {
      setDeploying(false)
    }
  }

  const loadTemplate = (templateName: string) => {
    const template = templates.find(t => t.name === templateName)
    if (template) {
      setCode(template.code)
      setContractName(templateName.toLowerCase().replace(/\s+/g, '_'))
      setCompileResult(null)
      setDeployResult(null)
    }
    setSelectedTemplate(templateName)
  }

  const downloadWasm = () => {
    if (compileResult?.success) {
      window.open(`${API_BASE_URL}/download-wasm/${contractName}`, '_blank')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="flex items-center space-x-2">
          <Loader2 className="animate-spin text-blue-500" />
          <span>Loading NEAR Contract Editor...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="container mx-auto p-4">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              NEAR Smart Contract Editor
            </h1>
            <p className="text-zinc-400">Write, compile, and deploy your NEAR smart contracts</p>
          </div>
          
          {/* Wallet Connection */}
          <div className="flex items-center space-x-3">
            {wallet.isSignedIn ? (
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2 bg-zinc-900 px-3 py-2 rounded-lg border border-zinc-800">
                  <Wallet className="w-4 h-4 text-green-500" />
                  <span className="text-sm text-zinc-300">{wallet.accountId}</span>
                </div>
                <button
                  onClick={disconnectWallet}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors text-sm"
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={connectWallet}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <Wallet className="w-4 h-4" />
                <span>Connect Wallet</span>
              </button>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-zinc-300">Contract Name</label>
              <input
                type="text"
                value={contractName}
                onChange={(e) => setContractName(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white placeholder-zinc-500"
                placeholder="my_contract"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-zinc-300">Template</label>
              <select
                value={selectedTemplate}
                onChange={(e) => loadTemplate(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-white"
              >
                <option value="">Choose a template...</option>
                {templates.map((template) => (
                  <option key={template.name} value={template.name}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end space-x-2">
              <button
                onClick={compileContract}
                disabled={compiling}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors"
              >
                {compiling ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                <span>{compiling ? 'Compiling...' : 'Compile'}</span>
              </button>

              {compileResult?.success && (
                <>
                  <button
                    onClick={downloadWasm}
                    className="flex items-center space-x-2 px-4 py-2 bg-green-600 hover:bg-green-700 rounded-md transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download WASM</span>
                  </button>
                  
                  <button
                    onClick={deployContract}
                    disabled={deploying || !wallet.isSignedIn}
                    className="flex items-center space-x-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors"
                  >
                    {deploying ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Rocket className="w-4 h-4" />
                    )}
                    <span>{deploying ? 'Deploying...' : 'Deploy to Testnet'}</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Template Description */}
          {selectedTemplate && (
            <div className="bg-zinc-800 border border-zinc-700 rounded p-3">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-blue-400" />
                <span className="font-medium text-white">{selectedTemplate}</span>
              </div>
              <p className="text-sm text-zinc-400 mt-1">
                {templates.find(t => t.name === selectedTemplate)?.description}
              </p>
            </div>
          )}

          {/* Deployment Status */}
          {deployResult && (
            <div className={`mt-4 p-3 rounded border ${
              deployResult.success 
                ? 'bg-green-900/20 border-green-500/30' 
                : 'bg-red-900/20 border-red-500/30'
            }`}>
              <div className="flex items-center space-x-2">
                {deployResult.success ? (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-500" />
                )}
                <span className={`font-medium ${deployResult.success ? 'text-green-400' : 'text-red-400'}`}>
                  {deployResult.success ? 'Deployment Successful!' : 'Deployment Failed'}
                </span>
              </div>
              
              {deployResult.success && deployResult.transactionHash && (
                <div className="mt-2 space-y-2">
                  <div className="text-sm">
                    <span className="text-zinc-400">Contract ID: </span>
                    <code className="text-green-400">{deployResult.contractId}</code>
                  </div>
                  <div className="text-sm">
                    <span className="text-zinc-400">Transaction: </span>
                    <a 
                      href={`https://testnet.nearblocks.io/txns/${deployResult.transactionHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 inline-flex items-center space-x-1"
                    >
                      <span>{deployResult.transactionHash.slice(0, 20)}...</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              )}
              
              {deployResult.error && (
                <div className="mt-2 text-sm text-red-300">
                  {deployResult.error}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Editor and Output */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Code Editor */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <div className="bg-zinc-800 px-4 py-2 border-b border-zinc-700">
              <h2 className="font-medium text-white">Smart Contract Code (Rust)</h2>
            </div>
            <div className="h-[600px]">
              <Editor
                height="100%"
                language="rust"
                theme="vs-dark"
                value={code}
                onChange={(value) => setCode(value || '')}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineNumbers: 'on',
                  roundedSelection: false,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 4,
                  insertSpaces: true,
                  fontFamily: 'JetBrains Mono, Monaco, Consolas, monospace',
                }}
              />
            </div>
          </div>

          {/* Output Panel */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
            <div className="bg-zinc-800 px-4 py-2 border-b border-zinc-700">
              <h2 className="font-medium text-white">Compilation Output</h2>
            </div>
            <div className="p-4 h-[600px] overflow-y-auto">
              {!compileResult ? (
                <div className="flex items-center justify-center h-full text-zinc-500">
                  <div className="text-center">
                    <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>Click "Compile" to see the results</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Status */}
                  <div className="flex items-center space-x-2">
                    {compileResult.success ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : (
                      <XCircle className="w-5 h-5 text-red-500" />
                    )}
                    <span className={`font-medium ${compileResult.success ? 'text-green-400' : 'text-red-400'}`}>
                      {compileResult.success ? 'Compilation Successful' : 'Compilation Failed'}
                    </span>
                  </div>

                  {/* WASM Size */}
                  {compileResult.wasm_size && (
                    <div className="bg-green-900/20 border border-green-500/30 rounded p-3">
                      <p className="text-green-400">
                        WASM file generated: {(compileResult.wasm_size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                  )}

                  {/* Output */}
                  {compileResult.output && (
                    <div>
                      <h3 className="font-medium mb-2 text-zinc-300">Build Output:</h3>
                      <pre className="bg-black border border-zinc-800 rounded p-3 text-sm text-green-400 overflow-x-auto font-mono">
                        {compileResult.output}
                      </pre>
                    </div>
                  )}

                  {/* Errors - only show when compilation failed */}
                  {!compileResult.success && compileResult.errors && (
                    <div>
                      <h3 className="font-medium mb-2 text-red-400">Errors:</h3>
                      <pre className="bg-red-900/20 border border-red-500/30 rounded p-3 text-sm text-red-300 overflow-x-auto font-mono">
                        {compileResult.errors}
                      </pre>
                    </div>
                  )}

                  {/* Warnings - show when compilation succeeded but has stderr output */}
                  {compileResult.success && compileResult.errors && (
                    <div>
                      <h3 className="font-medium mb-2 text-yellow-400">Warnings & Info:</h3>
                      <pre className="bg-yellow-900/20 border border-yellow-500/30 rounded p-3 text-sm text-yellow-300 overflow-x-auto font-mono">
                        {compileResult.errors}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-zinc-500">
          <p>NEAR Smart Contract Editor - Built with Next.js, TypeScript, and Rust</p>
        </div>
      </div>
    </div>
  )
}