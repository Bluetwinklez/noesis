//! Fetching user-supplied web addresses without reaching the local network.
//!
//! Every hop (including redirects) is resolved here, every resolved address must
//! be public, and the connection is pinned to the address that was checked, so a
//! DNS answer cannot change between the check and the request (DNS rebinding).

use serde::Serialize;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

pub const MAX_BYTES: usize = 25 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchedUrl {
    pub status: u16,
    pub content_type: String,
    pub final_url: String,
    pub bytes: Vec<u8>,
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_unspecified()
        || ip.is_multicast()
        || o[0] == 0
        || (o[0] == 100 && (64..128).contains(&o[1])) // carrier-grade NAT
        || (o[0] == 192 && o[1] == 0 && o[2] == 0)
        || (o[0] == 198 && (18..20).contains(&o[1]))
        || o[0] >= 240)
}

pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_public_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_public_v4(v4);
            }
            let s = v6.segments();
            !(v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (s[0] & 0xfe00) == 0xfc00 // unique local
                || (s[0] & 0xffc0) == 0xfe80 // link local
                || v6 == Ipv6Addr::LOCALHOST)
        }
    }
}

async fn resolve_public(u: &url::Url) -> Result<SocketAddr, String> {
    if !matches!(u.scheme(), "http" | "https") {
        return Err("Only http and https links can be imported.".into());
    }
    let host = u.host_str().ok_or("The link has no host name.")?;
    let port = u.port_or_known_default().ok_or("The link has no port.")?;
    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.trim_matches(['[', ']']), port))
        .await
        .map_err(|_| format!("Could not resolve {host}."))?
        .collect();
    if addrs.is_empty() {
        return Err(format!("Could not resolve {host}."));
    }
    if let Some(bad) = addrs.iter().find(|a| !is_public_ip(a.ip())) {
        return Err(format!("{host} points to a local or private network address ({}); blocked for safety.", bad.ip()));
    }
    Ok(addrs[0])
}

pub async fn fetch_public(raw: &str) -> Result<FetchedUrl, String> {
    let mut current = url::Url::parse(raw.trim()).map_err(|_| "Enter a valid web address starting with http:// or https://".to_string())?;
    for _ in 0..=MAX_REDIRECTS {
        let addr = resolve_public(&current).await?;
        let host = current.host_str().unwrap_or_default().to_string();
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .resolve(&host, addr)
            .timeout(Duration::from_secs(30))
            .user_agent("Noesis/0.1 (+https://github.com/Bluetwinklez/noesis)")
            .build()
            .map_err(|e| e.to_string())?;
        let mut res = client
            .get(current.clone())
            .header("Accept", "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5")
            .send()
            .await
            .map_err(|e| format!("Could not download the page: {e}"))?;
        if res.status().is_redirection() {
            let loc = res.headers().get("location").and_then(|v| v.to_str().ok()).ok_or("Redirect without a location.")?;
            current = current.join(loc).map_err(|_| "Invalid redirect location.".to_string())?;
            continue;
        }
        if res.content_length().is_some_and(|n| n as usize > MAX_BYTES) {
            return Err("The page is larger than 25 MB.".into());
        }
        let status = res.status().as_u16();
        let content_type = res.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
        let mut bytes = Vec::new();
        while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
            if bytes.len() + chunk.len() > MAX_BYTES {
                return Err("The page is larger than 25 MB.".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        return Ok(FetchedUrl { status, content_type, final_url: current.to_string(), bytes });
    }
    Err("Too many redirects.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_addresses() {
        for bad in ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"] {
            assert!(!is_public_ip(bad.parse().unwrap()), "{bad} must be blocked");
        }
        for good in ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(is_public_ip(good.parse().unwrap()), "{good} must be allowed");
        }
    }

    #[tokio::test]
    async fn refuses_local_targets_before_connecting() {
        for u in ["http://localhost:1420/", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd"] {
            assert!(fetch_public(u).await.is_err(), "{u} must be refused");
        }
    }
}
