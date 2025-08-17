use axum::{
    extract::Json,
    http::{HeaderValue, Method, StatusCode},
    response::Json as ResponseJson,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::fs;
use std::process::Command;
use tempfile::TempDir;
use tower::ServiceBuilder;
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, error};
use uuid::Uuid;

#[derive(Deserialize)]
struct CompileRequest {
    code: String,
    contract_name: String,
}

#[derive(Serialize)]
struct CompileResponse {
    success: bool,
    output: String,
    errors: Option<String>,
    wasm_size: Option<usize>,
}

#[derive(Serialize)]
struct ContractTemplate {
    name: String,
    description: String,
    code: String,
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    service: String,
}

async fn compile_contract(Json(req): Json<CompileRequest>) -> Result<ResponseJson<CompileResponse>, StatusCode> {
    let _contract_id = Uuid::new_v4().to_string();
    
    // Create temporary directory
    let temp_dir = match TempDir::new() {
        Ok(dir) => dir,
        Err(e) => {
            error!("Failed to create temp directory: {}", e);
            return Ok(ResponseJson(CompileResponse {
                success: false,
                output: String::new(),
                errors: Some(format!("Failed to create temp directory: {}", e)),
                wasm_size: None,
            }));
        },
    };

    let project_path = temp_dir.path();
    
    // Initialize cargo project
    let init_output = Command::new("cargo")
        .args(&["init", "--name", &req.contract_name, "--lib"])
        .current_dir(project_path)
        .output();

    if let Err(e) = init_output {
        error!("Failed to initialize cargo project: {}", e);
        return Ok(ResponseJson(CompileResponse {
            success: false,
            output: String::new(),
            errors: Some(format!("Failed to initialize cargo project: {}", e)),
            wasm_size: None,
        }));
    }

    // Clean any potential cache issues
    let _clean_output = Command::new("cargo")
        .args(&["clean"])
        .current_dir(project_path)
        .output();

    // Write Cargo.toml for NEAR contract
    let cargo_toml = format!(r#"[package]
name = "{}"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
near-sdk = "5.5.0"
borsh = {{ version = "1.0", features = ["derive"] }}

[profile.release]
codegen-units = 1
opt-level = "z"
lto = true
debug = false
panic = "abort"
overflow-checks = true
"#, req.contract_name);

    if let Err(e) = fs::write(project_path.join("Cargo.toml"), cargo_toml) {
        error!("Failed to write Cargo.toml: {}", e);
        return Ok(ResponseJson(CompileResponse {
            success: false,
            output: String::new(),
            errors: Some(format!("Failed to write Cargo.toml: {}", e)),
            wasm_size: None,
        }));
    }

    // Write the contract code
    let lib_rs_path = project_path.join("src").join("lib.rs");
    if let Err(e) = fs::write(&lib_rs_path, &req.code) {
        error!("Failed to write contract code: {}", e);
        return Ok(ResponseJson(CompileResponse {
            success: false,
            output: String::new(),
            errors: Some(format!("Failed to write contract code: {}", e)),
            wasm_size: None,
        }));
    }

    // Add wasm32-unknown-unknown target
    let _add_target = Command::new("rustup")
        .args(&["target", "add", "wasm32-unknown-unknown"])
        .output();

    // Compile the contract
    let compile_output = Command::new("cargo")
        .args(&["build", "--target", "wasm32-unknown-unknown", "--release"])
        .current_dir(project_path)
        .output();

    match compile_output {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            
            if output.status.success() {
                // Check if WASM file was generated
                let wasm_path = project_path
                    .join("target")
                    .join("wasm32-unknown-unknown")
                    .join("release")
                    .join(format!("{}.wasm", req.contract_name.replace("-", "_")));
                
                let wasm_size = if wasm_path.exists() {
                    fs::metadata(&wasm_path).ok().map(|m| m.len() as usize)
                } else {
                    None
                };

                info!("Contract compiled successfully");
                Ok(ResponseJson(CompileResponse {
                    success: true,
                    output: stdout.to_string(),
                    errors: if stderr.is_empty() { None } else { Some(stderr.to_string()) },
                    wasm_size,
                }))
            } else {
                error!("Compilation failed");
                Ok(ResponseJson(CompileResponse {
                    success: false,
                    output: stdout.to_string(),
                    errors: Some(stderr.to_string()),
                    wasm_size: None,
                }))
            }
        },
        Err(e) => {
            error!("Failed to execute cargo build: {}", e);
            Ok(ResponseJson(CompileResponse {
                success: false,
                output: String::new(),
                errors: Some(format!("Failed to execute cargo build: {}", e)),
                wasm_size: None,
            }))
        },
    }
}

async fn get_templates() -> ResponseJson<Vec<ContractTemplate>> {
    let templates = vec![
        ContractTemplate {
            name: "Hello World".to_string(),
            description: "Simple greeting contract".to_string(),
            code: r#"use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
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
}"#.to_string(),
        },
        ContractTemplate {
            name: "Counter".to_string(),
            description: "Simple counter with increment/decrement".to_string(),
            code: r#"use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::{env, near_bindgen};

#[near_bindgen]
#[derive(Default, BorshDeserialize, BorshSerialize)]
pub struct Counter {
    value: i32,
}

#[near_bindgen]
impl Counter {
    pub fn get_num(&self) -> i32 {
        self.value
    }

    pub fn increment(&mut self) {
        self.value += 1;
        env::log_str(&format!("Counter incremented to: {}", self.value));
    }

    pub fn decrement(&mut self) {
        self.value -= 1;
        env::log_str(&format!("Counter decremented to: {}", self.value));
    }

    pub fn reset(&mut self) {
        self.value = 0;
        env::log_str(&format!("Counter reset to: {}", self.value));
    }

    pub fn set(&mut self, value: i32) {
        self.value = value;
        env::log_str(&format!("Counter set to: {}", self.value));
    }
}"#.to_string(),
        },
    ];

    ResponseJson(templates)
}

async fn health_check() -> ResponseJson<HealthResponse> {
    ResponseJson(HealthResponse {
        status: "healthy".to_string(),
        service: "NEAR Contract Compiler".to_string(),
    })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize tracing
    tracing_subscriber::fmt::init();
    
    // Configure CORS
    let cors = CorsLayer::new()
        .allow_origin("http://localhost:3000".parse::<HeaderValue>()?)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers(Any);

    // Build our application with routes
    let app = Router::new()
        .route("/health", get(health_check))
        .route("/compile", post(compile_contract))
        .route("/templates", get(get_templates))
        .layer(
            ServiceBuilder::new()
                .layer(cors)
        );

    let listener = tokio::net::TcpListener::bind("127.0.0.1:8080").await?;
    info!("Starting NEAR Contract Compiler Server on http://localhost:8080");

    axum::serve(listener, app).await?;

    Ok(())
}
