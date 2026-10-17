using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using PrintAgent.Models;

namespace PrintAgent.Services
{
    /// <summary>标签纸库文件结构: 独立 labelpapers.json, 便于珠宝云整库同步覆盖</summary>
    public class LabelPaperLibrary
    {
        public int Version { get; set; } = 1;
        public DateTime UpdatedAt { get; set; } = DateTime.Now;
        public List<LabelPaper> Papers { get; set; } = new List<LabelPaper>();
    }

    /// <summary>标签纸形状库存取(线程安全): exe 目录 labelpapers.json</summary>
    public static class LabelPaperStore
    {
        private static readonly object _lock = new object();

        // 单文件发布时 BaseDirectory 指向解包临时目录, 必须用 exe 所在目录定位
        private static readonly string FilePath = Path.Combine(
            Path.GetDirectoryName(Environment.ProcessPath) ?? AppDomain.CurrentDomain.BaseDirectory, "labelpapers.json");

        public static LabelPaperLibrary Load()
        {
            lock (_lock)
            {
                if (!File.Exists(FilePath)) return new LabelPaperLibrary();
                try
                {
                    return JsonConvert.DeserializeObject<LabelPaperLibrary>(File.ReadAllText(FilePath)) ?? new LabelPaperLibrary();
                }
                catch
                {
                    return new LabelPaperLibrary();
                }
            }
        }

        public static void Save(LabelPaperLibrary lib)
        {
            lock (_lock)
            {
                lib.Version++;
                lib.UpdatedAt = DateTime.Now;
                File.WriteAllText(FilePath, JsonConvert.SerializeObject(lib, Formatting.Indented));
            }
        }

        /// <summary>按 Id 或名称查找</summary>
        public static LabelPaper? Find(string idOrName)
        {
            if (string.IsNullOrWhiteSpace(idOrName)) return null;
            var lib = Load();
            return lib.Papers.FirstOrDefault(p => p.Id.Equals(idOrName, StringComparison.OrdinalIgnoreCase))
                ?? lib.Papers.FirstOrDefault(p => p.Name.Equals(idOrName, StringComparison.OrdinalIgnoreCase));
        }

        /// <summary>upsert 一条(无 Id 则生成); 返回落库后的对象</summary>
        public static LabelPaper Upsert(LabelPaper paper)
        {
            if (string.IsNullOrWhiteSpace(paper.Id)) paper.Id = Guid.NewGuid().ToString("N");
            paper.UpdatedAt = DateTime.Now;
            var lib = Load();
            var old = lib.Papers.FirstOrDefault(p => p.Id == paper.Id);
            if (old != null) lib.Papers[lib.Papers.IndexOf(old)] = paper;
            else lib.Papers.Add(paper);
            Save(lib);
            return paper;
        }

        public static bool Delete(string id)
        {
            var lib = Load();
            var old = lib.Papers.FirstOrDefault(p => p.Id.Equals(id, StringComparison.OrdinalIgnoreCase));
            if (old == null) return false;
            lib.Papers.Remove(old);
            Save(lib);
            return true;
        }

        /// <summary>云同步: replace=整库覆盖, merge=按 Id 合并; 全部标记 Source=cloud。返回 (新增, 更新)</summary>
        public static (int added, int updated) Sync(List<LabelPaper> papers, string mode)
        {
            var lib = Load();
            int added = 0, updated = 0;
            if (mode.Equals("replace", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var p in papers) { p.Source = "cloud"; p.UpdatedAt = DateTime.Now; }
                lib.Papers = new List<LabelPaper>(papers);
                added = papers.Count; // replace 语义下不区分更新数
            }
            else
            {
                foreach (var p in papers)
                {
                    p.Source = "cloud";
                    p.UpdatedAt = DateTime.Now;
                    var old = lib.Papers.FirstOrDefault(x => x.Id == p.Id);
                    if (old != null) { lib.Papers[lib.Papers.IndexOf(old)] = p; updated++; }
                    else { lib.Papers.Add(p); added++; }
                }
            }
            Save(lib);
            return (added, updated);
        }
    }
}
