//! Thin HTTPS GET used by the live NearBlocks fetcher.
//!
//! - On `wasm32-*` (OutLayer / wasmtime P2): `wasi-http-client` → wasi:http.
//! - On the host: `ureq` (unit tests and local smoke).

use std::time::Duration;

#[cfg(not(target_family = "wasm"))]
use std::io::Read;

#[derive(Debug)]
pub struct HttpError(pub String);

impl std::fmt::Display for HttpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// GET `url`, optional Bearer API key. Returns response body bytes.
pub fn get(url: &str, api_key: Option<&str>) -> Result<Vec<u8>, HttpError> {
    #[cfg(target_family = "wasm")]
    {
        use wasi_http_client::Client;
        let mut req = Client::new().get(url).connect_timeout(Duration::from_secs(20));
        if let Some(k) = api_key {
            let auth = format!("Bearer {k}");
            req = req.header("Authorization", auth.as_str());
        }
        let resp = req.send().map_err(|e| HttpError(format!("http send: {e}")))?;
        let status = resp.status();
        let body = resp.body().map_err(|e| HttpError(format!("http body: {e}")))?;
        if status == 429 {
            return Err(HttpError("nearblocks 429".into()));
        }
        if !(200..300).contains(&status) {
            return Err(HttpError(format!(
                "nearblocks {status}: {}",
                String::from_utf8_lossy(&body).chars().take(160).collect::<String>()
            )));
        }
        Ok(body)
    }

    #[cfg(not(target_family = "wasm"))]
    {
        let mut req = ureq::get(url).timeout(Duration::from_secs(20));
        if let Some(k) = api_key {
            req = req.set("Authorization", &format!("Bearer {k}"));
        }
        let resp = req.call().map_err(|e| HttpError(format!("http send: {e}")))?;
        let status = resp.status();
        let mut body = Vec::new();
        resp.into_reader()
            .read_to_end(&mut body)
            .map_err(|e| HttpError(format!("http body: {e}")))?;
        if status == 429 {
            return Err(HttpError("nearblocks 429".into()));
        }
        if !(200..300).contains(&status) {
            return Err(HttpError(format!(
                "nearblocks {status}: {}",
                String::from_utf8_lossy(&body).chars().take(160).collect::<String>()
            )));
        }
        Ok(body)
    }
}

pub fn get_json(url: &str, api_key: Option<&str>) -> Result<serde_json::Value, HttpError> {
    let body = get(url, api_key)?;
    serde_json::from_slice(&body).map_err(|e| HttpError(format!("json: {e}")))
}
