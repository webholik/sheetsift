use std::path::PathBuf;
use std::sync::Mutex;

/// 화면 기동 이전에 도달한 개방 요청도 수령 시점까지 보전한다.
#[derive(Default)]
pub struct OpenFiles(Mutex<Vec<PathBuf>>);

impl OpenFiles {
    #[cfg(any(target_os = "macos", test))]
    pub fn receive(&self, urls: Vec<tauri::Url>) {
        self.0
            .lock()
            .expect("개방 요청 상태가 훼손되었습니다")
            .extend(urls.into_iter().filter_map(|url| url.to_file_path().ok()));
    }

    pub fn take(&self) -> Vec<PathBuf> {
        std::mem::take(&mut *self.0.lock().expect("개방 요청 상태가 훼손되었습니다"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_and_later_requests_are_delivered_once_in_order() {
        let files = OpenFiles::default();
        let first = std::env::temp_dir().join("first.xlsx");
        let second = std::env::temp_dir().join("second.xls");
        let third = std::env::temp_dir().join("third.csv");
        files.receive(vec![tauri::Url::from_file_path(&first).unwrap()]);
        files.receive(vec![tauri::Url::from_file_path(&second).unwrap()]);
        assert_eq!(files.take(), [first, second]);
        assert!(files.take().is_empty());
        files.receive(vec![tauri::Url::from_file_path(&third).unwrap()]);
        assert_eq!(files.take(), [third]);
    }

    #[test]
    fn file_urls_decode_spaces_unicode_and_literal_percent_signs() {
        let path = std::env::temp_dir().join("매출 report %20 #1.xlsx");
        let files = OpenFiles::default();
        files.receive(vec![tauri::Url::from_file_path(&path).unwrap()]);
        assert_eq!(files.take(), [path]);
    }

    #[test]
    fn remote_urls_do_not_become_local_file_requests() {
        let files = OpenFiles::default();
        files.receive(vec![
            tauri::Url::parse("https://example.com/book.xlsx").unwrap()
        ]);
        assert!(files.take().is_empty());
    }
}
