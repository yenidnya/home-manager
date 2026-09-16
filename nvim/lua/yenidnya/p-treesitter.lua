return {
	"nvim-treesitter/nvim-treesitter",
	build = ":TSUpdate",
	branch = "main",
	lazy = false,
	config = function()
		require("nvim-treesitter").install({
			"c",
			"lua",
			"vim",
			"vimdoc",
			"javascript",
			"html",
			"tsx",
			"rust",
			"json",
			"typescript",
		})

		-- The main branch does not attach highlighting; Neovim only auto-starts it
		-- for its own bundled parsers (lua, markdown, help, query).
		vim.api.nvim_create_autocmd("FileType", {
			group = vim.api.nvim_create_augroup("yenidnya_treesitter_start", {}),
			callback = function(args)
				local lang = vim.treesitter.language.get_lang(vim.bo[args.buf].filetype)
				if lang and vim.treesitter.language.add(lang) then
					vim.treesitter.start(args.buf, lang)
				end
			end,
		})
	end,
}
