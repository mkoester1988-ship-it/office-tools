using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace OfficeToolsInstaller
{
    public class InstallerForm : Form
    {
        private readonly Label _statusLabel;
        private readonly ProgressBar _progressBar;
        private const string ApiUrl = "https://api.github.com/repos/mkoester1988-ship-it/office-tools/releases/latest";

        public InstallerForm()
        {
            Text = "PDF-Reader Studio – Web-Installer";
            Size = new Size(460, 165);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            BackColor = Color.FromArgb(24, 28, 38);
            ForeColor = Color.FromArgb(241, 245, 249);

            _statusLabel = new Label
            {
                Text = "Suche neueste Version auf GitHub...",
                Location = new Point(20, 22),
                Size = new Size(405, 28),
                Font = new Font("Segoe UI", 10.5f, FontStyle.Regular)
            };

            _progressBar = new ProgressBar
            {
                Location = new Point(20, 60),
                Size = new Size(405, 26),
                Style = ProgressBarStyle.Marquee
            };

            Controls.Add(_statusLabel);
            Controls.Add(_progressBar);

            Load += async (s, e) => await StartDownloadAsync();
        }

        private async Task StartDownloadAsync()
        {
            try
            {
                ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
                string json;
                using (var client = new WebClient())
                {
                    client.Headers.Add("User-Agent", "OfficeTools-Installer");
                    json = await client.DownloadStringTaskAsync(ApiUrl);
                }

                var match = Regex.Match(json, "\"browser_download_url\"\\s*:\\s*\"([^\"]+\\.exe)\"", RegexOptions.IgnoreCase);
                if (!match.Success)
                {
                    MessageBox.Show("Kein Setup im neuesten GitHub-Release gefunden.", "Fehler", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    Close();
                    return;
                }

                string downloadUrl = match.Groups[1].Value;
                string tempExe = Path.Combine(Path.GetTempPath(), "PDF-Reader-Studio-Setup.exe");

                _progressBar.Style = ProgressBarStyle.Continuous;
                _progressBar.Minimum = 0;
                _progressBar.Maximum = 100;
                _statusLabel.Text = "Lade PDF-Reader Studio herunter...";

                using (var dlClient = new WebClient())
                {
                    dlClient.Headers.Add("User-Agent", "OfficeTools-Installer");
                    dlClient.DownloadProgressChanged += (sender, args) =>
                    {
                        _progressBar.Value = Math.Min(100, Math.Max(0, args.ProgressPercentage));
                        double mbDone = args.BytesReceived / (1024.0 * 1024.0);
                        double mbTotal = args.TotalBytesToReceive / (1024.0 * 1024.0);
                        if (mbTotal > 0)
                        {
                            _statusLabel.Text = string.Format("Heruntergeladen: {0:F1} MB / {1:F1} MB ({2}%)", mbDone, mbTotal, args.ProgressPercentage);
                        }
                    };
                    await dlClient.DownloadFileTaskAsync(new Uri(downloadUrl), tempExe);
                }

                _statusLabel.Text = "Starte Installation...";
                Process.Start(new ProcessStartInfo
                {
                    FileName = tempExe,
                    UseShellExecute = true
                });
                Close();
            }
            catch (Exception ex)
            {
                MessageBox.Show("Download fehlgeschlagen:\n" + ex.Message, "PDF-Reader Studio", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }

        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new InstallerForm());
        }
    }
}
